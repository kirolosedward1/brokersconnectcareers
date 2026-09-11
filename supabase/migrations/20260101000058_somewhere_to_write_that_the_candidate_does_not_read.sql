-- =============================================================================
-- 58 — The note an employer cannot currently write
--
-- There is one note field on an application and the candidate reads it.
-- `decision_note` exists so a rejection can say why, which is the whole point
-- of the board — a decision you can act on rather than guess at. It is not
-- somewhere to write "called, no answer, try Thursday".
--
-- So an HR manager comparing twelve applicants has nowhere to put the one
-- thing that makes comparing twelve applicants possible, and the obvious
-- workaround — typing it into decision_note and hoping — sends it to the
-- person it is about.
--
-- A table rather than a column, and the reason is not preference.
-- Row-level security is row-level: the candidate's own select policy returns
-- their whole application row, so a column on `applications` would reach them
-- whatever the application layer selected. Postgres can restrict a column by
-- privilege, but employer and candidate are both `authenticated`, so that
-- cannot separate them either. A separate table with its own policy is the
-- only place this can live where the rule is the database's rather than a
-- promise made by every query that ever touches the row.
--
-- Being a table also makes it the right shape. "Called, callback Thursday",
-- then "spoke to them, wants 12k", then "offered" is a log of a conversation,
-- not one field overwritten three times — the same argument migration 42 made
-- for application_events.
-- =============================================================================

create table if not exists application_notes (
  id             bigint generated always as identity primary key,
  application_id uuid not null references applications(id) on delete cascade,
  -- Null when the colleague who wrote it has closed their account: what they
  -- observed about the candidate outlives their login, and the team still
  -- needs it.
  author_id      uuid references profiles(id) on delete set null,
  body           text not null check (length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);

-- Every read is "this application, oldest first" — a conversation in order.
create index if not exists application_notes_application_idx
  on application_notes (application_id, created_at);

-- For the cascade when an account closes.
create index if not exists application_notes_author_idx
  on application_notes (author_id);

alter table application_notes enable row level security;

/*
  The company, and nobody else.

  `owns_job` is membership-based, so every colleague working the same inbox
  sees the same notes — which is the point of writing one. The candidate has
  no policy here at all, which is how this schema spells "not yours to read":
  the same way email_log is service-role only.
*/
create policy application_notes_read on application_notes
  for select using (
    exists (
      select 1 from applications a
       where a.id = application_notes.application_id
         and public.owns_job(a.job_id)
    )
  );

create policy application_notes_write on application_notes
  for insert with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from applications a
       where a.id = application_notes.application_id
         and public.owns_job(a.job_id)
    )
  );

/*
  Deleted by whoever wrote it, and only them.

  Not by any member: a note is somebody's observation, and a colleague
  removing it is a different act from tidying up your own. Editing is
  deliberately absent for the same reason the event log has no update — a
  record that can be rewritten after the fact is worth less than one that
  cannot.
*/
create policy application_notes_delete on application_notes
  for delete using (author_id = (select auth.uid()));

create policy application_notes_admin on application_notes
  for all using (public.is_admin()) with check (public.is_admin());
