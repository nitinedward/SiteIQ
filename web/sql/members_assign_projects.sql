-- Any engineer can put people on a project
--
-- engineers_add_projects.sql let a member add only themselves, so a project
-- an engineer started could not be shared with the colleague doing the next
-- visit without an admin stepping in. This opens that up: any member of the
-- firm can assign any other member of the same firm to any of the firm's
-- projects, and take them off again — the toggle in Firm Settings (mobile)
-- and on the dashboard (web) works both ways, so both directions are needed.
--
-- Still fenced: the project must belong to your firm and the person must be
-- in your firm, so nobody can reach across firms. Creating, editing and
-- deleting the project itself are unchanged — delete stays admin-only.
--
-- Run this once in the Supabase SQL editor, after engineers_add_projects.sql.

-- Which firm someone belongs to. SECURITY DEFINER for the same reason as the
-- other helpers: a policy that read firm_members directly would need the
-- caller to have permission to read it, and that recurses.
create or replace function public.member_firm_id(u uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select firm_id from public.firm_members where user_id = u limit 1 $$;

drop policy if exists "Members add themselves to a project" on public.project_members;
drop policy if exists "Firm members assign project members" on public.project_members;
create policy "Firm members assign project members"
  on public.project_members for insert
  with check (
    public.project_firm_id(project_id) = public.current_firm_id()
    and public.member_firm_id(user_id) = public.current_firm_id()
  );

drop policy if exists "Firm members unassign project members" on public.project_members;
create policy "Firm members unassign project members"
  on public.project_members for delete
  using (public.project_firm_id(project_id) = public.current_firm_id());

-- What remains on the table, to paste back for checking.
select policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public' and tablename = 'project_members'
 order by policyname;
