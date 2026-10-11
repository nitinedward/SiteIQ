-- Dictation recordings kept with each site note
--
-- The phone app now transcribes dictation on the phone (offline Whisper)
-- and keeps the recording: it is uploaded beside the note's photos
-- (observation-photos/audio/…) and listed here, as a record of what was
-- said on site and so it can be transcribed again later.
--
--   audio = ["https://…/observation-photos/audio/dictation-….wav", …]
--
-- Additive and safe to run on the live database: until it has run, notes
-- still save, just without their recordings listed. Run once in the
-- Supabase SQL editor. Safe to run again.

alter table public.observations
  add column if not exists audio jsonb not null default '[]'::jsonb;
