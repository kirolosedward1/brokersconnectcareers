-- =============================================================================
-- 50 — The colleague whose edit disappeared
--
-- A company is a team. company_members has admins and recruiters, the console
-- lets an admin invite either, and every admin may edit the company record and
-- any listing on it. So two people editing the same listing is not a contrived
-- case — it is what inviting a colleague is for.
--
-- What happens today is that the second save wins and the first is gone, with
-- nothing on either screen to say so. Worse on a live listing than a draft:
-- the second saver's copy is what goes back to the moderation queue, so the
-- listing that returns to the board is the one nobody meant to send.
--
-- `version` rather than a timestamp. A timestamptz round-trips through
-- PostgREST as a string with microseconds in it, and comparing it back depends
-- on that formatting being stable both ways; an integer that only ever goes up
-- compares exactly and reads plainly in a query. The form carries the version
-- it loaded, the update matches on it, and a save against a version that has
-- moved matches zero rows — which the action already distinguishes from "not
-- yours", because it reads the row first.
--
-- Only these two tables. The other editable records — a consultant's directory
-- profile, their CV sections, an account's own settings — have exactly one
-- writer, so the only conflict possible is somebody's own two tabs, and
-- refusing that would cost more than it saves.
-- =============================================================================

alter table jobs      add column if not exists version int not null default 1;
alter table companies add column if not exists version int not null default 1;

create or replace function public.bump_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Every update, including ones that change nothing else: a no-op write is
  -- still a write, and treating it as one keeps the number honest.
  new.version := old.version + 1;
  return new;
end;
$$;

revoke execute on function public.bump_version() from public, anon, authenticated;

drop trigger if exists jobs_40_bump_version on jobs;
drop trigger if exists companies_40_bump_version on companies;

-- On jobs this fires after the three numbered guards, which is the order the
-- prefixes were introduced for. On companies the existing guard is unnumbered
-- — `companies_guard_update` — so this one sorts ahead of it and runs first.
-- That is harmless rather than lucky: a guard that raises aborts the whole
-- statement, so the bump is rolled back with everything else and no version is
-- ever spent on an update that did not happen.
create trigger jobs_40_bump_version
  before update on jobs
  for each row execute function public.bump_version();

create trigger companies_40_bump_version
  before update on companies
  for each row execute function public.bump_version();
