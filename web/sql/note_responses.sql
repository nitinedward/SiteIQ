-- Site note responses
--
-- What comes back from site after a note is raised: the contractor's reply,
-- a photo of the remedial work, an email or a PDF. Each response is a
-- comment, an optional uploaded file, or both — and the note is usually
-- closed once one lands.
--
-- Run this once in the Supabase SQL editor. The Site Notes tab shows this
-- script in place of the response panel until the table exists.

create extension if not exists "pgcrypto";

create table if not exists public.note_responses (
  id             uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.observations(id) on delete cascade,
  comment        text not null default '',
  file_url       text,
  file_name      text,
  file_type      text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);

create index if not exists note_responses_observation_idx
  on public.note_responses (observation_id, created_at);

alter table public.note_responses enable row level security;

-- Anyone signed in can read and add a response; only the author can remove
-- their own. Uploaded files live in the existing public observation-photos
-- bucket under note-responses/<observation id>/.
drop policy if exists note_responses_select on public.note_responses;
create policy note_responses_select on public.note_responses
  for select to authenticated using (true);

drop policy if exists note_responses_insert on public.note_responses;
create policy note_responses_insert on public.note_responses
  for insert to authenticated with check (true);

drop policy if exists note_responses_delete on public.note_responses;
create policy note_responses_delete on public.note_responses
  for delete to authenticated using (created_by = auth.uid());
