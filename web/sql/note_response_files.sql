-- Site note comments: several files per comment
--
-- A response started life as one comment with at most one file, so the files
-- attached to a single comment had to be split across rows. They belong to
-- what was said, so they are stored with it:
--
--   files = [{ "url": "...", "name": "...", "type": "image/jpeg" }, ...]
--
-- The original file_url / file_name / file_type columns stay, and are still
-- written with the first file, so responses recorded before this — and
-- anything else reading those columns — keep working.
--
-- Run this once in the Supabase SQL editor. Until it runs, a comment with
-- several files still saves, but falls back to the old shape: the comment on
-- the first row and the remaining files as rows of their own.

alter table public.note_responses
  add column if not exists files jsonb not null default '[]'::jsonb;
