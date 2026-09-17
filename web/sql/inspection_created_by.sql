-- Reports: who carried out the inspection
--
-- Nothing recorded the engineer against an inspection, so reports fell back
-- to the literal "Site Engineer" wherever the template asks for the
-- engineer's name or email address.
--
-- Existing reports are backfilled from finalised_by — whoever finalised a
-- report is the best record we have of who wrote it. Reports never finalised
-- stay empty and keep the old fallback.
--
-- Run this once in the Supabase SQL editor.

alter table public.inspections
  add column if not exists created_by uuid;

update public.inspections
   set created_by = finalised_by
 where created_by is null
   and finalised_by is not null;
