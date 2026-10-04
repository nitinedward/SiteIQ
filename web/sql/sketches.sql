-- Sketches
--
-- Hand sketches and Bluebeam exports dropped into a report in the office:
-- a scan or photo (JPG/PNG) or a PDF of one or more pages. Each is linked to
-- the site note it explains, so the report captions it with that note and
-- the note lists it — traceable from either side.
--
--   observation_id  the site note it belongs to; null = "General" for the
--                   report in inspection_id. Deleting the note leaves the
--                   sketch in its report as General rather than losing it.
--   inspection_id   the report it was added to (or the report of the note it
--                   was attached to). A sketch shows in a report when its
--                   note is in that report, or it is General there.
--   file_url        the file as uploaded, kept so it can be opened exactly
--                   as drawn
--   pages           what goes into the report, one image per page:
--                   [{ "url": "...", "width": 2400, "height": 1697 }, ...]
--
-- Files live in the public observation-photos bucket under
-- sketches/<project id>/<sketch id>/, uploaded straight from the browser
-- with one-time links from /api/sketches (large PDFs would not fit through
-- a function).
--
-- Run this in the Supabase SQL editor; it is safe to run again. Until it
-- runs, the Sketches panels show this script instead. Needs access_rules.sql
-- (for current_firm_id()) to have been run first.

create extension if not exists "pgcrypto";

create table if not exists public.sketches (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  inspection_id  uuid references public.inspections(id) on delete cascade,
  observation_id uuid references public.observations(id) on delete set null,
  title          text not null default '',
  file_url       text not null,
  file_name      text,
  file_type      text,
  pages          jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);

create index if not exists sketches_inspection_idx  on public.sketches (inspection_id, created_at);
create index if not exists sketches_observation_idx on public.sketches (observation_id, created_at);
create index if not exists sketches_project_idx     on public.sketches (project_id);

alter table public.sketches enable row level security;

-- Firm-only, like the rest of the project's records (access_rules.sql, whose
-- current_firm_id() this uses): a signed-in member of the firm that owns the
-- project can read, add, move and retitle its sketches; nobody else sees
-- them. Adding or moving one also checks that the report and site note it
-- points at are in that same project, so a sketch can't be planted in
-- another firm's report. Deleting goes through /api/sketches, which checks
-- the firm and removes the files too, so there is no delete policy.
--
-- Columns are qualified with the table name: inside a subquery on
-- observations an unqualified project_id would mean the note's, not the
-- sketch's.
--
-- Safe to run again — it replaces the policies an earlier version of this
-- script created, which let any signed-in user of any firm in.
drop policy if exists sketches_select on public.sketches;
drop policy if exists sketches_insert on public.sketches;
drop policy if exists sketches_update on public.sketches;
drop policy if exists "Firm reads its sketches"   on public.sketches;
drop policy if exists "Firm adds its sketches"    on public.sketches;
drop policy if exists "Firm changes its sketches" on public.sketches;

create policy "Firm reads its sketches"
  on public.sketches for select to authenticated
  using (exists (
    select 1 from public.projects p
     where p.id = sketches.project_id and p.firm_id = public.current_firm_id()
  ));

create policy "Firm adds its sketches"
  on public.sketches for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
       where p.id = sketches.project_id and p.firm_id = public.current_firm_id()
    )
    and (sketches.inspection_id is null or exists (
      select 1 from public.inspections i
       where i.id = sketches.inspection_id and i.project_id = sketches.project_id
    ))
    and (sketches.observation_id is null or exists (
      select 1 from public.observations o
        left join public.inspections oi on oi.id = o.inspection_id
       where o.id = sketches.observation_id
         and sketches.project_id in (o.project_id, oi.project_id)
    ))
  );

create policy "Firm changes its sketches"
  on public.sketches for update to authenticated
  using (exists (
    select 1 from public.projects p
     where p.id = sketches.project_id and p.firm_id = public.current_firm_id()
  ))
  with check (
    exists (
      select 1 from public.projects p
       where p.id = sketches.project_id and p.firm_id = public.current_firm_id()
    )
    and (sketches.inspection_id is null or exists (
      select 1 from public.inspections i
       where i.id = sketches.inspection_id and i.project_id = sketches.project_id
    ))
    and (sketches.observation_id is null or exists (
      select 1 from public.observations o
        left join public.inspections oi on oi.id = o.inspection_id
       where o.id = sketches.observation_id
         and sketches.project_id in (o.project_id, oi.project_id)
    ))
  );

-- What is on the table now, to check: three "Firm … its sketches" rows.
select policyname, cmd, roles::text from pg_policies where tablename = 'sketches';
