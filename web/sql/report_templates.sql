-- Named report templates, chosen per project
--
-- A firm used to have exactly one Word template (firms.report_template_url).
-- Offices with different letterheads need their own, so templates now live
-- in their own table with a name, and each project points at one. A project
-- with no template set uses the firm's default.
--
-- Changing a project's template only affects reports generated afterwards:
-- inspections.report_template_id records the template a report was first
-- built from, and every later rebuild of that report (AI regenerate, "use
-- notes text") keeps using it.
--
-- firms.report_template_url stays, mirroring the default template's file.
-- Installed mobile apps read it to decide whether AI reports are available.
--
-- Run this once in the Supabase SQL editor, before deploying the web app
-- that uses it. Until it runs, reports keep using the firm's single template.

create table if not exists public.report_templates (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  name        text not null,
  file_url    text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  -- Bumped when the file is replaced; the server's template cache is keyed on it.
  updated_at  timestamptz not null default now()
);

-- At most one default per firm.
create unique index if not exists report_templates_one_default_per_firm
  on public.report_templates (firm_id) where is_default;

alter table public.projects
  add column if not exists report_template_id uuid
  references public.report_templates(id) on delete set null;

alter table public.inspections
  add column if not exists report_template_id uuid
  references public.report_templates(id) on delete set null;

-- The existing single template becomes each firm's "Default".
insert into public.report_templates (firm_id, name, file_url, is_default)
select f.id, 'Default', f.report_template_url, true
  from public.firms f
 where f.report_template_url is not null
   and not exists (select 1 from public.report_templates t where t.firm_id = f.id);

-- Reports that already have a document were built from that template, so
-- pin them to it. Inspections with no document yet stay unpinned and pick up
-- their project's template when first generated.
update public.inspections i
   set report_template_id = t.id
  from public.projects p
  join public.report_templates t on t.firm_id = p.firm_id and t.is_default
 where i.project_id = p.id
   and i.report_template_id is null
   and exists (
     select 1 from storage.objects o
      where o.bucket_id = 'reports' and o.name = i.id::text || '.docx'
   );

-- Firm members can see their firm's templates (to pick one for a project);
-- only admins can add, rename, replace or remove them.
alter table public.report_templates enable row level security;

drop policy if exists "Firm members read report templates" on public.report_templates;
create policy "Firm members read report templates"
  on public.report_templates for select
  using (firm_id in (select firm_id from public.firm_members where user_id = auth.uid()));

drop policy if exists "Firm admins manage report templates" on public.report_templates;
create policy "Firm admins manage report templates"
  on public.report_templates for all
  using (firm_id in (select firm_id from public.firm_members where user_id = auth.uid() and role = 'admin'))
  with check (firm_id in (select firm_id from public.firm_members where user_id = auth.uid() and role = 'admin'));
