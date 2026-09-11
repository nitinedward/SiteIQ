-- Observations: open/closed only
--
-- observations.severity used to hold a severity grade, pinned by a check
-- constraint to NONE / LOW / MEDIUM / HIGH / CRITICAL. Observations are now
-- recorded as OPEN or CLOSED in the same column (the column name is
-- historic), so writing one fails with:
--
--   new row for relation "observations" violates check constraint
--   "observations_severity_check"
--
-- This migrates the graded rows and narrows the constraint to the two
-- values that remain. Everything that was graded becomes OPEN — a grade
-- said how serious an item was, never that it had been resolved, so
-- reading any of them as closed would sign off work nobody has signed off.
--
-- Run this once in the Supabase SQL editor. Until it runs, closing or
-- reopening a note on the web, and saving an observation in the mobile app,
-- both fail with the error above.

update public.observations
   set severity = 'OPEN'
 where severity is null
    or severity <> 'CLOSED';

alter table public.observations
  drop constraint if exists observations_severity_check;

alter table public.observations
  add constraint observations_severity_check
  check (severity in ('OPEN', 'CLOSED'));

-- New observations are open until someone closes them.
alter table public.observations
  alter column severity set default 'OPEN';

alter table public.observations
  alter column severity set not null;
