-- =============================================================================
-- 374 — Replies a team keeps
--
-- Saved replies lived on one phone, for one person (the app's local list):
-- a team could not share them and a new phone started empty
-- (docs/design/v1.1/phase-b/06). They are kept here now, on WhatsApp or by
-- email (decided), each either the whole team's or one person's own.
--
--   read     any member of the company: the team's, and their own
--   write    their own, any member; the team's, the company's admins
--
-- Variables ({name}, {first_name}, {job}, {company}, {stage}) are checked by
-- the website's action and filled on the phone (WhatsApp) or by the email
-- that sends them. Tested in supabase/tests/saved-replies.test.mjs.
--
-- rollback: drop table if exists saved_replies;
-- safety: additive — a new table; the app's local replies are offered for
-- upload, and stay on the phone until they are.
-- =============================================================================

create table if not exists saved_replies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  person_id    uuid references profiles(id) on delete cascade,     -- null: the whole team's
  title       text check (char_length(title) <= 80),
  body        text not null check (char_length(body) between 1 and 1000),
  channel     text not null default 'whatsapp' check (channel in ('whatsapp', 'email')),
  version     int not null default 1,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists saved_replies_company_idx on saved_replies (company_id, created_at);
create index if not exists saved_replies_person_idx on saved_replies (person_id);
create index if not exists saved_replies_created_by_idx on saved_replies (created_by);

alter table saved_replies enable row level security;

create policy saved_replies_read on saved_replies
  for select using (
    company_id = (select public.my_company_id())
    and (person_id is null or person_id = (select auth.uid()))
  );

-- One's own: any member, in their own company.
create policy saved_replies_own on saved_replies
  for all using (
    person_id = (select auth.uid()) and company_id = (select public.my_company_id())
  ) with check (
    person_id = (select auth.uid()) and company_id = (select public.my_company_id())
  );

-- The team's: the company's admins.
create policy saved_replies_team on saved_replies
  for all using (
    person_id is null and public.is_company_admin(company_id)
  ) with check (
    person_id is null and public.is_company_admin(company_id)
  );

grant select, insert, update, delete on saved_replies to authenticated;
