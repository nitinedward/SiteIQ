-- Observations: how the report words each note
--
-- observations.transcript is what was dictated or typed on site, and it stays
-- that way — it is the record of what was actually observed, and nothing in
-- the report pipeline may overwrite it.
--
-- report_text is separate: the sentence the generated report uses for that
-- same observation. Generating a report fills it in per observation, so a
-- site note can show both what was said on site and how the report puts it.
--
-- Null means no report has been generated for that observation yet (or it was
-- generated before this column existed). An empty string is never written.
--
-- Run this once in the Supabase SQL editor. Until it runs, report generation
-- still works — the per-observation write is skipped and logged, and the
-- document is produced exactly as before.

alter table public.observations
  add column if not exists report_text text;

comment on column public.observations.report_text is
  'How the generated report words this observation. Written by '
  '/api/docs/ai-generate. Never overwrites transcript, which is the on-site '
  'record.';
