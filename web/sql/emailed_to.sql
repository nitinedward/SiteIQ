-- "Emailed to" on reports ({{emailed_to}}): by default the site contact
-- recorded on the phone when the visit started, or a person the project
-- nominates instead, and either can be overridden for one report. Names only
-- (lib/reportRecipients, emailedToName).
--
-- Stored as {"siteContact": true} or {"name": "…"}; null on a project means
-- the site contact, null on a report means "as the project says".
--
-- Run once in the Supabase SQL editor. Before it runs, every report's
-- "Emailed to" is its site contact and the settings can't be saved.

alter table public.projects
  add column if not exists emailed_to jsonb;

alter table public.inspections
  add column if not exists emailed_to jsonb;
