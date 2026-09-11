-- Observations: allow the open/closed status
--
-- observations.severity used to hold a severity grade, and a check
-- constraint pins it to that old set. Observations are now recorded as OPEN
-- or CLOSED in the same column, so writing one fails with:
--
--   new row for relation "observations" violates check constraint
--   "observations_severity_check"
--
-- This widens the constraint. The graded values stay allowed so the
-- existing rows (NONE, LOW) remain valid and nothing has to be rewritten.
--
-- Run this once in the Supabase SQL editor. Until it runs, closing or
-- reopening a note on the web, and saving an observation in the mobile app,
-- both fail with the error above.

alter table public.observations
  drop constraint if exists observations_severity_check;

alter table public.observations
  add constraint observations_severity_check
  check (severity in ('OPEN', 'CLOSED', 'NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
