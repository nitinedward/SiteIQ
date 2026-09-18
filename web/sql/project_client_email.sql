-- Projects: the client's email address
--
-- Reports print an address under "Issued To", but nothing recorded the
-- client's, so the report showed the engineer's own address there instead.
-- It's set on the project, alongside the client's name.
--
-- Run this once in the Supabase SQL editor. Until it runs, the line under
-- "Issued To" is left blank on new reports.

alter table public.projects
  add column if not exists client_email text;
