-- Close-out packs (PS4)
--
-- A project's close-out pack is its PS4 (producer statement, construction
-- review) on top of its site reports and registers — or, without a PS4, just
-- the reports and registers. Built on the project's Close-out tab.
--
--   firms.ps4_settings   the firm's own PS4 form (the fillable ACE NZ /
--                        Engineering NZ PDF) and its "is / is not a member
--                        of ACE New Zealand" answer. Settings.
--   projects.closeout    what was read from the project's design PS1 and
--                        which details are checked, the consent and
--                        amendment numbers, and the project's PS4 author.
--                        Written only through /api/closeout/* (engineers
--                        use the tab too, and projects is admin-write).
--   ps4_authors          the engineers who can approve and sign a firm's
--                        PS4s: name, the email the approval link goes to,
--                        CPEng number, qualifications, signature. Any member
--                        reads them (to pick one); admins add and change
--                        them. No delete: an author is made inactive, so the
--                        PS4s they signed still name them.
--
-- Files (PS4 form, PS1s, signatures, draft packs) are in the private
-- `reports` bucket under closeout/<firm id>/, reached only through the
-- /api/closeout routes with the service key — no storage policies needed.
--
-- Run in the Supabase SQL editor; safe to run again.
-- Needs access_rules.sql (current_firm_id(), is_firm_admin()).

create extension if not exists "pgcrypto";

alter table public.firms    add column if not exists ps4_settings jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists closeout     jsonb not null default '{}'::jsonb;

create table if not exists public.ps4_authors (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms(id) on delete cascade,
  name            text not null,
  email           text not null,
  cpeng           text not null default '',
  qualifications  text not null default '',
  signature_path  text,
  user_id         uuid references auth.users(id) on delete set null,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists ps4_authors_firm_idx on public.ps4_authors (firm_id);

alter table public.ps4_authors enable row level security;

drop policy if exists "Firm reads its PS4 authors"   on public.ps4_authors;
drop policy if exists "Admins add PS4 authors"       on public.ps4_authors;
drop policy if exists "Admins change PS4 authors"    on public.ps4_authors;

create policy "Firm reads its PS4 authors"
  on public.ps4_authors for select to authenticated
  using (firm_id = public.current_firm_id());

create policy "Admins add PS4 authors"
  on public.ps4_authors for insert to authenticated
  with check (firm_id = public.current_firm_id() and public.is_firm_admin());

create policy "Admins change PS4 authors"
  on public.ps4_authors for update to authenticated
  using (firm_id = public.current_firm_id() and public.is_firm_admin())
  with check (firm_id = public.current_firm_id() and public.is_firm_admin());

grant select, insert, update on public.ps4_authors to authenticated;
