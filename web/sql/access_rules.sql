-- Who may do what
--
-- Two things this settles:
--
-- 1. Only an admin creates or deletes a project. An engineer joins the firm
--    with the code, the admin adds them to the projects they work on, and
--    they can read and work on those — but never add or remove a project.
--
-- 2. Several tables were readable AND writable by anyone holding the public
--    key, which ships inside the web page and the app. Checked on
--    2026-09-20 with no login at all: inspections, observations, zones,
--    drawings and project_members all returned rows, and an insert into
--    observations succeeded (the row was removed again immediately). With
--    more than one firm on the system that is every firm's site data
--    readable by anyone who views the site. Everything below requires a
--    signed-in member of the firm that owns the row.
--
-- The app's own server routes use the service key and bypass all of this,
-- so report generation, finalising, project deletion and the join-by-code
-- route keep working exactly as they do now.
--
-- Run this once in the Supabase SQL editor. Read it first: it changes who
-- can see and change data.

-- ── Helpers ────────────────────────────────────────────────────────────────
-- Both are SECURITY DEFINER so a policy can read firm_members without the
-- caller needing their own permission to, which would recurse.

create or replace function public.current_firm_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select firm_id from public.firm_members where user_id = auth.uid() limit 1
$$;

create or replace function public.is_firm_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.firm_members
     where user_id = auth.uid() and role = 'admin'
  )
$$;

-- ── Projects: admins add and remove, the firm reads ────────────────────────
alter table public.projects enable row level security;

drop policy if exists "Firm reads its projects" on public.projects;
create policy "Firm reads its projects"
  on public.projects for select
  using (firm_id = public.current_firm_id());

drop policy if exists "Admins create projects" on public.projects;
create policy "Admins create projects"
  on public.projects for insert
  with check (firm_id = public.current_firm_id() and public.is_firm_admin());

drop policy if exists "Admins change projects" on public.projects;
create policy "Admins change projects"
  on public.projects for update
  using (firm_id = public.current_firm_id() and public.is_firm_admin())
  with check (firm_id = public.current_firm_id() and public.is_firm_admin());

drop policy if exists "Admins delete projects" on public.projects;
create policy "Admins delete projects"
  on public.projects for delete
  using (firm_id = public.current_firm_id() and public.is_firm_admin());

-- ── Who is on a project: admins decide ─────────────────────────────────────
alter table public.project_members enable row level security;

drop policy if exists "Firm reads project members" on public.project_members;
create policy "Firm reads project members"
  on public.project_members for select
  using (exists (
    select 1 from public.projects p
     where p.id = project_id and p.firm_id = public.current_firm_id()
  ));

drop policy if exists "Admins assign project members" on public.project_members;
create policy "Admins assign project members"
  on public.project_members for all
  using (public.is_firm_admin() and exists (
    select 1 from public.projects p
     where p.id = project_id and p.firm_id = public.current_firm_id()
  ))
  with check (public.is_firm_admin() and exists (
    select 1 from public.projects p
     where p.id = project_id and p.firm_id = public.current_firm_id()
  ));

-- ── The work itself: any member of the owning firm ─────────────────────────
-- Engineers record inspections, notes and markups, and upload drawings, so
-- these stay open to the firm — just not to the public.

alter table public.inspections enable row level security;
drop policy if exists "Firm works its inspections" on public.inspections;
create policy "Firm works its inspections"
  on public.inspections for all
  using (exists (
    select 1 from public.projects p
     where p.id = project_id and p.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.projects p
     where p.id = project_id and p.firm_id = public.current_firm_id()
  ));

alter table public.drawings enable row level security;
drop policy if exists "Firm works its drawings" on public.drawings;
create policy "Firm works its drawings"
  on public.drawings for all
  using (exists (
    select 1 from public.projects p
     where p.id = project_id and p.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.projects p
     where p.id = project_id and p.firm_id = public.current_firm_id()
  ));

-- Notes and markups reach their firm through the project or the inspection,
-- because a general note carries no project and an older row may carry no
-- inspection.
alter table public.observations enable row level security;
drop policy if exists "Firm works its site notes" on public.observations;
create policy "Firm works its site notes"
  on public.observations for all
  using (
    exists (select 1 from public.projects p where p.id = project_id and p.firm_id = public.current_firm_id())
    or exists (
      select 1 from public.inspections i join public.projects p on p.id = i.project_id
       where i.id = inspection_id and p.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (select 1 from public.projects p where p.id = project_id and p.firm_id = public.current_firm_id())
    or exists (
      select 1 from public.inspections i join public.projects p on p.id = i.project_id
       where i.id = inspection_id and p.firm_id = public.current_firm_id()
    )
  );

alter table public.zones enable row level security;
drop policy if exists "Firm works its markups" on public.zones;
create policy "Firm works its markups"
  on public.zones for all
  using (
    exists (select 1 from public.projects p where p.id = project_id and p.firm_id = public.current_firm_id())
    or exists (
      select 1 from public.inspections i join public.projects p on p.id = i.project_id
       where i.id = inspection_id and p.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (select 1 from public.projects p where p.id = project_id and p.firm_id = public.current_firm_id())
    or exists (
      select 1 from public.inspections i join public.projects p on p.id = i.project_id
       where i.id = inspection_id and p.firm_id = public.current_firm_id()
    )
  );

-- Replies to a note follow the note.
alter table public.note_responses enable row level security;
drop policy if exists "Firm works its note responses" on public.note_responses;
create policy "Firm works its note responses"
  on public.note_responses for all
  using (exists (
    select 1 from public.observations o
      left join public.projects p on p.id = o.project_id
      left join public.inspections i on i.id = o.inspection_id
      left join public.projects ip on ip.id = i.project_id
     where o.id = observation_id
       and public.current_firm_id() in (p.firm_id, ip.firm_id)
  ))
  with check (exists (
    select 1 from public.observations o
      left join public.projects p on p.id = o.project_id
      left join public.inspections i on i.id = o.inspection_id
      left join public.projects ip on ip.id = i.project_id
     where o.id = observation_id
       and public.current_firm_id() in (p.firm_id, ip.firm_id)
  ));
