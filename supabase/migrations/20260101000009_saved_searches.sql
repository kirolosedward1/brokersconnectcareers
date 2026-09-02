-- =============================================================================
-- 09 — Saved searches
--
-- The return mechanism. Everything before this gets somebody to apply once;
-- this is what brings them back without paying for the visit twice.
--
-- The filters are stored as the query string the person was actually looking
-- at, not as a parsed set of columns. That is deliberate: the application
-- already has one parser for those parameters, and the weekly digest has to
-- run the same search the candidate would see if they opened the link. A
-- second, structured copy of the filter model would be a second thing to keep
-- in step, and the first time it drifted the email would quietly stop matching
-- the page.
-- =============================================================================

create table saved_searches (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references profiles on delete cascade,
  label         text not null check (length(btrim(label)) between 1 and 80),
  -- The canonical query string, without page or sort: two saves of the same
  -- filters on different pages are the same search.
  query         text not null default '' check (length(query) <= 500),
  alerts        boolean not null default true,
  last_sent_at  timestamptz,
  created_at    timestamptz not null default now(),

  -- Saving the same search twice is a no-op, not a second row.
  unique (candidate_id, query)
);

create index saved_searches_candidate_idx on saved_searches (candidate_id, created_at desc);

-- The digest walks this: only rows with alerts on, oldest send first.
create index saved_searches_alerts_idx on saved_searches (alerts, last_sent_at)
  where alerts;

-- ---------------------------------------------------------------------------
-- A cap, enforced in the database.
--
-- Ten is well past what anyone uses and well short of what turns the weekly
-- digest into a mail run. Enforced here rather than in the action because the
-- action is not the only way rows could arrive.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_saved_search_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from saved_searches where candidate_id = new.candidate_id) >= 10 then
    raise exception 'saved_search_cap'
      using hint = 'Delete an existing saved search first.';
  end if;
  return new;
end;
$$;

create trigger saved_searches_enforce_cap
  before insert on saved_searches
  for each row execute function public.enforce_saved_search_cap();

-- ---------------------------------------------------------------------------
-- RLS: a saved search is private to the person who saved it. There is no
-- public read, no employer read, and nothing to share.
-- ---------------------------------------------------------------------------

alter table saved_searches enable row level security;

create policy saved_searches_owner_select on saved_searches
  for select using (candidate_id = auth.uid());

create policy saved_searches_owner_insert on saved_searches
  for insert with check (candidate_id = auth.uid());

create policy saved_searches_owner_update on saved_searches
  for update using (candidate_id = auth.uid())
  with check (candidate_id = auth.uid());

create policy saved_searches_owner_delete on saved_searches
  for delete using (candidate_id = auth.uid());

-- ---------------------------------------------------------------------------
-- last_sent_at is written by the digest job, never by its owner — otherwise
-- resetting it would be a way to ask for the same email repeatedly.
-- ---------------------------------------------------------------------------

create or replace function public.guard_saved_search_update()
returns trigger
language plpgsql
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.last_sent_at is distinct from old.last_sent_at then
    raise exception 'last_sent_at is set by the alert job, not by the owner';
  end if;
  if new.candidate_id is distinct from old.candidate_id then
    raise exception 'a saved search cannot change owner';
  end if;

  return new;
end;
$$;

create trigger saved_searches_guard_update
  before update on saved_searches
  for each row execute function public.guard_saved_search_update();
