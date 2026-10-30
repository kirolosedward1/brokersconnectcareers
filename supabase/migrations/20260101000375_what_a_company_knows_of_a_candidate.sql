-- =============================================================================
-- 375 — What a company knows of a candidate
--
-- Notes were kept on one application (migration 58): "called, no answer" on
-- the March listing was not on the card of the same person's June
-- application. A company now keeps notes about the person, read on every
-- application they send it, by the whole company (decided), and sees the
-- earlier applications they sent it — «تقدّم من قبل»
-- (docs/design/v1.1/phase-b/02).
--
-- Nothing crosses companies: a note is the company's, about somebody who
-- applied to it; the history is the company's own applications. The
-- candidate never reads either, and their data export does not mention the
-- notes (decided).
--
--   read     the company's members (owns_job on one of the person's
--            applications to it)
--   write    the same, as themselves
--   remove   the note's author, or one of the company's admins
--
-- Tested in supabase/tests/candidate-notes.test.mjs.
--
-- rollback: drop function if exists public.candidate_history_for(uuid[]);
--           drop function if exists public.candidate_notes_for(uuid[]);
--           drop table if exists company_candidate_notes;
-- safety: additive — a new table and two read functions under RLS.
-- safety: ships-with-code — a new table and functions used only by code added in this branch: code
--   first, those reads answer an error until it runs and nothing that exists today changes; migration first, nothing uses them yet.
-- =============================================================================

create table if not exists company_candidate_notes (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references companies(id) on delete cascade,
  candidate_id    uuid not null references profiles(id) on delete cascade,
  author_id       uuid references profiles(id) on delete set null,
  body            text not null check (char_length(body) between 1 and 2000),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  unique (company_id, idempotency_key)
);

create index if not exists company_candidate_notes_lookup_idx on company_candidate_notes (company_id, candidate_id, created_at);
create index if not exists company_candidate_notes_candidate_idx on company_candidate_notes (candidate_id);
create index if not exists company_candidate_notes_author_idx on company_candidate_notes (author_id);

alter table company_candidate_notes enable row level security;

-- Whether the caller works this company's applications from this person.
create or replace function public.knows_candidate(p_company uuid, p_candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from applications a join jobs j on j.id = a.job_id
     where a.candidate_id = p_candidate and j.company_id = p_company and public.owns_job(j.id)
  );
$$;

revoke execute on function public.knows_candidate(uuid, uuid) from public, anon;
grant execute on function public.knows_candidate(uuid, uuid) to authenticated, service_role;

create policy company_candidate_notes_read on company_candidate_notes
  for select using (public.knows_candidate(company_id, candidate_id));

create policy company_candidate_notes_write on company_candidate_notes
  for insert with check (
    author_id = (select auth.uid()) and public.knows_candidate(company_id, candidate_id)
  );

create policy company_candidate_notes_remove on company_candidate_notes
  for delete using (
    public.knows_candidate(company_id, candidate_id)
    and (author_id = (select auth.uid()) or public.is_company_admin(company_id))
  );

create policy company_candidate_notes_admin on company_candidate_notes
  for all using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, delete on company_candidate_notes to authenticated;

-- ---------------------------------------------------------------------------
-- For the cards on screen: the notes about each one's candidate, and the
-- other applications they sent this company. Invoker: row-level security
-- decides what comes back, as for any read.
-- ---------------------------------------------------------------------------

create or replace function public.candidate_notes_for(p_application_ids uuid[])
returns table (for_application uuid, id bigint, author_id uuid, body text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id, n.id, n.author_id, n.body, n.created_at
    from applications a
    join jobs j on j.id = a.job_id
    join company_candidate_notes n on n.company_id = j.company_id and n.candidate_id = a.candidate_id
   where a.id = any (p_application_ids[1:200])
   order by n.created_at;
$$;

create or replace function public.candidate_history_for(p_application_ids uuid[])
returns table (for_application uuid, application_id uuid, job_title_ar text, job_title_en text,
               status application_status, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id, other.id, oj.title_ar, oj.title_en, other.status, other.created_at
    from applications a
    join jobs j on j.id = a.job_id
    join applications other on other.candidate_id = a.candidate_id and other.id <> a.id
    join jobs oj on oj.id = other.job_id and oj.company_id = j.company_id
   where a.id = any (p_application_ids[1:200])
   order by other.created_at desc;
$$;

revoke execute on function public.candidate_notes_for(uuid[]) from public, anon;
revoke execute on function public.candidate_history_for(uuid[]) from public, anon;
grant execute on function public.candidate_notes_for(uuid[]) to authenticated, service_role;
grant execute on function public.candidate_history_for(uuid[]) to authenticated, service_role;
