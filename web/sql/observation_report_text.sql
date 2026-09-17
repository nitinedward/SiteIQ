-- Site notes: the wording each note has in its finalised report
--
-- Finalising a report copies each site note's final bullet text (including
-- edits made in the editor) back onto the note, so the Site Notes views on
-- the web and in the mobile app read the same as the report. What the
-- engineer dictated on site stays in transcript/notes, untouched.
--
-- Run this once in the Supabase SQL editor, before deploying the web app
-- that uses it. Until it runs, finalising still works but the wording isn't
-- copied (the finalise message says so).

alter table public.observations
  add column if not exists report_text text;

alter table public.observations
  add column if not exists report_text_updated_at timestamptz;
