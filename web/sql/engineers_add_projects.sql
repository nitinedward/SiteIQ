-- Engineers may start a project; only admins may remove one
--
-- access_rules.sql made adding and deleting both admin-only. Adding is the
-- everyday act — an engineer arrives at a new job and needs somewhere to put
-- the inspection — while deleting destroys reports, notes, drawings and
-- their files. So the two are separated here.
--
-- Also lets a member put themselves on a project they just created,
-- otherwise it would not appear in their own list: the app shows an engineer
-- the projects they are assigned to. Adding anyone ELSE stays with the
-- admin, which is the "admin decides who works what" rule.
--
-- Unchanged: deleting a project is admins only, in the database and in the
-- app's delete route.
--
-- Run this once in the Supabase SQL editor.

drop policy if exists "Admins create projects" on public.projects;
drop policy if exists "Firm members create projects" on public.projects;
create policy "Firm members create projects"
  on public.projects for insert
  with check (firm_id = public.current_firm_id());

drop policy if exists "Members add themselves to a project" on public.project_members;
create policy "Members add themselves to a project"
  on public.project_members for insert
  with check (
    user_id = auth.uid()
    and public.project_firm_id(project_id) = public.current_firm_id()
  );
