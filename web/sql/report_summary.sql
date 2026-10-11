-- A short description of each site report
--
-- Shown under the report's name in a project's Reports list on the web, so
-- an engineer can tell what a report covers without opening it. The AI
-- writes it from the report's site notes (api/reports/summary); an engineer
-- can edit it, and summary_edited then stops the AI replacing their wording.
--
-- Additive and safe to run on the live database: until it has run, the list
-- simply shows no description.
--
-- Run once in the Supabase SQL editor. Safe to run again.

alter table public.inspections
  add column if not exists summary text;

alter table public.inspections
  add column if not exists summary_edited boolean not null default false;
