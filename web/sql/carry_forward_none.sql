-- Lets a report keep "None" as its choice of earlier reports' items: the
-- report page's option that leaves the template's earlier-items section
-- ({{#earlier_section}} … {{/earlier_section}}) out of the report.
--
-- Run once in the Supabase SQL editor. Before it runs, "None" still works
-- for the rewrite or table update it's chosen for, but isn't remembered for
-- the report (lib/observationBlocks, chooseCarryForward).

alter table public.inspections
  drop constraint if exists inspections_carry_forward_check;

alter table public.inspections
  add constraint inspections_carry_forward_check
  check (carry_forward is null or carry_forward in ('open', 'open_recent', 'all', 'none'));
