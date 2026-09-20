-- Fix: policies that call each other
--
-- access_rules.sql gave project_members a policy that reads projects, not
-- knowing projects already had a policy that reads project_members. Each
-- then had to consult the other to answer, and Postgres stopped it:
--
--   42P17: infinite recursion detected in policy for relation "projects"
--
-- Every query failed with that, for signed-in users as much as for anyone
-- else, so this needs running as soon as it is read.
--
-- The cure is to stop policies reading RLS-protected tables at all. These
-- helpers answer "which firm owns this?" as the function's owner, so no
-- second policy is consulted and there is no cycle to fall into.
--
-- Run this once in the Supabase SQL editor, after access_rules.sql.

create or replace function public.project_firm_id(p uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select firm_id from public.projects where id = p $$;

create or replace function public.inspection_firm_id(i uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.firm_id
    from public.inspections ins
    join public.projects p on p.id = ins.project_id
   where ins.id = i
$$;

create or replace function public.observation_firm_id(o uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.project_firm_id(obs.project_id),
    public.inspection_firm_id(obs.inspection_id)
  )
  from public.observations obs
  where obs.id = o
$$;

-- ── Who is on a project ────────────────────────────────────────────────────
drop policy if exists "Firm reads project members" on public.project_members;
create policy "Firm reads project members"
  on public.project_members for select
  using (public.project_firm_id(project_id) = public.current_firm_id());

drop policy if exists "Admins assign project members" on public.project_members;
create policy "Admins assign project members"
  on public.project_members for all
  using (public.is_firm_admin() and public.project_firm_id(project_id) = public.current_firm_id())
  with check (public.is_firm_admin() and public.project_firm_id(project_id) = public.current_firm_id());

-- ── The work ───────────────────────────────────────────────────────────────
drop policy if exists "Firm works its inspections" on public.inspections;
create policy "Firm works its inspections"
  on public.inspections for all
  using (public.project_firm_id(project_id) = public.current_firm_id())
  with check (public.project_firm_id(project_id) = public.current_firm_id());

drop policy if exists "Firm works its drawings" on public.drawings;
create policy "Firm works its drawings"
  on public.drawings for all
  using (public.project_firm_id(project_id) = public.current_firm_id())
  with check (public.project_firm_id(project_id) = public.current_firm_id());

-- A general note carries no project, and an older row may carry no
-- inspection, so either route to the firm counts.
drop policy if exists "Firm works its site notes" on public.observations;
create policy "Firm works its site notes"
  on public.observations for all
  using (
    public.project_firm_id(project_id) = public.current_firm_id()
    or public.inspection_firm_id(inspection_id) = public.current_firm_id()
  )
  with check (
    public.project_firm_id(project_id) = public.current_firm_id()
    or public.inspection_firm_id(inspection_id) = public.current_firm_id()
  );

drop policy if exists "Firm works its markups" on public.zones;
create policy "Firm works its markups"
  on public.zones for all
  using (
    public.project_firm_id(project_id) = public.current_firm_id()
    or public.inspection_firm_id(inspection_id) = public.current_firm_id()
  )
  with check (
    public.project_firm_id(project_id) = public.current_firm_id()
    or public.inspection_firm_id(inspection_id) = public.current_firm_id()
  );

drop policy if exists "Firm works its note responses" on public.note_responses;
create policy "Firm works its note responses"
  on public.note_responses for all
  using (public.observation_firm_id(observation_id) = public.current_firm_id())
  with check (public.observation_firm_id(observation_id) = public.current_firm_id());
