-- Projects: who the report is issued to
--
-- A report goes to the same people each visit, and that list differs from
-- project to project — so engineers were retyping names and addresses into
-- every report by hand. The list belongs to the project, and reports fill it
-- in from there.
--
-- Stored as a JSON array of { "name": "...", "email": "..." }, in the order
-- they should be printed.
--
-- Run this once in the Supabase SQL editor.

alter table public.projects
  add column if not exists report_recipients jsonb not null default '[]'::jsonb;
