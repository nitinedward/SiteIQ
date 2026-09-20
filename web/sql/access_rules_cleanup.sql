-- Remove the older "allow anyone" policies
--
-- Policies are permissive by default: Postgres allows a row if ANY policy
-- says yes. These tables still carry earlier policies that allow everyone,
-- so the rules added in access_rules.sql restrict nothing. Checked again
-- after that migration, with the public key and no login: rows still came
-- back from project_members, inspections, observations, zones and drawings,
-- and an insert into observations still succeeded (the row was removed).
--
-- This drops every policy on those tables EXCEPT the ones access_rules.sql
-- and access_rules_fix.sql created, and lists what it dropped so there is a
-- record of what was there.
--
-- Read before running. After it, these tables answer only to a signed-in
-- member of the firm that owns the row; the app's server routes use the
-- service key and are unaffected.

do $$
declare
  r record;
  keep text[] := array[
    'Firm reads its projects',
    'Admins create projects',
    'Admins change projects',
    'Admins delete projects',
    'Firm reads project members',
    'Admins assign project members',
    'Firm works its inspections',
    'Firm works its drawings',
    'Firm works its site notes',
    'Firm works its markups',
    'Firm works its note responses'
  ];
begin
  for r in
    select schemaname, tablename, policyname, cmd, roles::text as roles
      from pg_policies
     where schemaname = 'public'
       and tablename in ('projects', 'project_members', 'inspections',
                         'observations', 'zones', 'drawings', 'note_responses')
       and not (policyname = any (keep))
  loop
    raise notice 'dropping % on % (for %, roles %)', r.policyname, r.tablename, r.cmd, r.roles;
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- What remains, to paste back for checking.
select tablename, policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public'
   and tablename in ('projects', 'project_members', 'inspections',
                     'observations', 'zones', 'drawings', 'note_responses')
 order by tablename, policyname;
