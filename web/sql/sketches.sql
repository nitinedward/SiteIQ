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
-- Run this once in the Supabase SQL editor. Until it runs, the Sketches
-- panels show this script instead.

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

-- Like site note responses: anyone signed in can read, add, move and
-- retitle a sketch. Deleting goes through /api/sketches, which checks the
-- firm and removes the files too.
drop policy if exists sketches_select on public.sketches;
create policy sketches_select on public.sketches
  for select to authenticated using (true);

drop policy if exists sketches_insert on public.sketches;
create policy sketches_insert on public.sketches
  for insert to authenticated with check (true);

drop policy if exists sketches_update on public.sketches;
create policy sketches_update on public.sketches
  for update to authenticated using (true) with check (true);
