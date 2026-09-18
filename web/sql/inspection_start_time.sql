-- Reports: the time the inspection started
--
-- Reports print a time beside the date. Nothing recorded one, so it fell
-- back to when the report row was created, which is close but not the time
-- the engineer was on site. The mobile app now records it when an
-- inspection is started, and the engineer can correct it there.
--
-- Stored as the text the report prints ("14:00"), like inspections.date.
-- Existing reports keep falling back to their created_at.
--
-- Run this once in the Supabase SQL editor.

alter table public.inspections
  add column if not exists start_time text;
