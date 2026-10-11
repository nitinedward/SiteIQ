-- A one-line version of each site note, for a report's summary table
--
-- Templates can put {{brief}} in the summary table where the full wording
-- ({{finding}}) is too long. The AI writes the brief alongside the report
-- text and it is kept on the note here, so rebuilding the text from the
-- plain notes, and later reports listing the note among earlier items, use
-- the same line. Without this column a brief is the first sentence of the
-- note, cut short.
--
-- Additive and safe to run on the live database. Run once in the Supabase
-- SQL editor. Safe to run again.

alter table public.observations
  add column if not exists brief text;
