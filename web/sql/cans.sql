-- Consultant Advice Notices (CANs)
--
-- A CAN is issued once everything is agreed, as a PDF, and often carries a
-- sketch of what is to be built. It is uploaded whole on the project's CANs
-- tab; AI reads it, fills in its number, title, revision and date, and finds
-- the sketch pages. Each sketch page the engineer confirms becomes a sketch
-- (web/sql/sketches.sql) — linkable to a site note, shown in the Sketches
-- tab, and available on site to mark up like a drawing.
--
--   cans                one row per issued revision of a CAN. A new revision
--                       of the same number marks the previous one superseded
--                       (kept on record, out of the on-site lists).
--   sketches.can_id     the CAN a sketch came from, and can_page the page
--   drawings.kind       'drawing' for an uploaded drawing (the default — every
--                       existing row), 'sketch' for the hidden companion that
--                       lets a sketch be opened and marked up on site with the
--                       same tools as a drawing; drawings.sketch_id links it.
--
-- Files live in the public observation-photos bucket: the CAN under
-- cans/<project id>/<can id>/, uploaded straight from the browser on a
-- one-time link from /api/cans; its sketch pages under sketches/… as for any
-- sketch.
--
-- Run this in the Supabase SQL editor after sketches.sql; safe to run again.
-- Needs access_rules.sql (current_firm_id()).

create extension if not exists "pgcrypto";

create table if not exists public.cans (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  number         text not null,
  title          text not null default '',
  revision       text not null default '',
  issued_on      date,
  summary        text not null default '',
  file_url       text not null,
  file_name      text,
  page_count     integer not null default 0,
  status         text not null default 'current' check (status in ('current', 'superseded')),
  superseded_by  uuid references public.cans(id) on delete set null,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);

create index if not exists cans_project_idx on public.cans (project_id, number);
-- One record per revision of a CAN number on a project.
create unique index if not exists cans_number_revision_uq
  on public.cans (project_id, lower(number), lower(revision));

alter table public.sketches add column if not exists can_id   uuid references public.cans(id) on delete set null;
alter table public.sketches add column if not exists can_page integer;
create index if not exists sketches_can_idx on public.sketches (can_id);

alter table public.drawings add column if not exists kind text not null default 'drawing';
alter table public.drawings add column if not exists sketch_id uuid references public.sketches(id) on delete set null;

alter table public.cans enable row level security;

-- Firm-only, like drawings. Deleting goes through /api/cans, which checks
-- the firm, refuses while site markups depend on the CAN's sketches, and
-- removes the files — so there is no delete policy.
drop policy if exists "Firm reads its CANs"   on public.cans;
drop policy if exists "Firm adds its CANs"    on public.cans;
drop policy if exists "Firm changes its CANs" on public.cans;

create policy "Firm reads its CANs"
  on public.cans for select to authenticated
  using (exists (
    select 1 from public.projects p
     where p.id = cans.project_id and p.firm_id = public.current_firm_id()
  ));

create policy "Firm adds its CANs"
  on public.cans for insert to authenticated
  with check (exists (
    select 1 from public.projects p
     where p.id = cans.project_id and p.firm_id = public.current_firm_id()
  ));

create policy "Firm changes its CANs"
  on public.cans for update to authenticated
  using (exists (
    select 1 from public.projects p
     where p.id = cans.project_id and p.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.projects p
     where p.id = cans.project_id and p.firm_id = public.current_firm_id()
  ));

-- A sketch may only name a CAN of its own project.
drop policy if exists "Firm adds its sketches"    on public.sketches;
drop policy if exists "Firm changes its sketches" on public.sketches;

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
    and (sketches.can_id is null or exists (
      select 1 from public.cans c
       where c.id = sketches.can_id and c.project_id = sketches.project_id
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
    and (sketches.can_id is null or exists (
      select 1 from public.cans c
       where c.id = sketches.can_id and c.project_id = sketches.project_id
    ))
  );

-- What is on the two tables now, to check.
select tablename, policyname, cmd from pg_policies
 where tablename in ('cans', 'sketches') order by tablename, policyname;
