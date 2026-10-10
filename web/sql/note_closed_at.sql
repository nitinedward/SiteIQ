-- When each site note was closed
--
-- Reports built from a template with {{#open_items}} rows list the project's
-- earlier items that are still open, and those closed since the previous
-- report — which needs to know when an item was closed. Closing only ever
-- set observations.severity to 'CLOSED', so this adds the date, stamped by
-- the database whenever a note is closed (from the web or the app, no app
-- change needed) and cleared if it is reopened.
--
-- Additive and safe to run on the live database: nothing reads closed_at
-- until a template uses {{#open_items}}. Notes already closed keep no date,
-- so they never show as "recently closed".
--
-- Run once in the Supabase SQL editor. Safe to run again.

alter table public.observations
  add column if not exists closed_at timestamptz;

create or replace function public.stamp_observation_closed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if upper(coalesce(new.severity, '')) = 'CLOSED' then
    -- Only when it becomes closed: re-saving a closed note keeps its date.
    if tg_op = 'INSERT' then
      new.closed_at := coalesce(new.closed_at, now());
    elsif upper(coalesce(old.severity, '')) <> 'CLOSED' then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end
$$;

drop trigger if exists observations_closed_at on public.observations;
create trigger observations_closed_at
  before insert or update of severity on public.observations
  for each row execute function public.stamp_observation_closed_at();
