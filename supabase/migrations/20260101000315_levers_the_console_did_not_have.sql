-- =============================================================================
-- 315 — Levers the console did not have
--
-- The console could approve or suspend an *account*, and verify or reject a
-- company's *papers*. Four things an operator needs had no state to write to,
-- so they were done — when they were done — by editing rows in Supabase:
--
--   A company can be suspended. Suspending the owner's account only takes the
--   listings down when nobody else in good standing is left (migration 33),
--   which is right for one bad recruiter and wrong for a firm that is itself
--   the problem. suspended_at is the firm-level switch, and a trigger keeps a
--   suspended company off the board by every path, not only the console's.
--
--   A consultant can be restricted. visibility is the consultant's own choice,
--   so an admin setting it to hidden was undone the next time they saved
--   their profile. restricted_at pins it hidden until an admin lifts it —
--   coerced rather than refused, so an impersonator can still be *seen* by
--   the one person who should see them (the admin) while their saves keep
--   working and change nothing about who else can.
--
--   A report can be about a company or a consultant, not only a listing, and
--   can be under investigation rather than only open or closed.
--
--   Taxonomy rows cannot be broken by editing them. A slug is a URL (the
--   <track>-<district> landing pages are built from it) and a district id sits
--   in agent_profiles.district_ids, an array no foreign key can see — so a
--   delete that the FKs allowed could still strip a district from every
--   consultant who works there.
--
-- Nothing here changes a row that exists today: every new column is nullable
-- or defaulted, and historical reports are mapped to the status their boolean
-- already implied.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Companies: a suspension, separate from the papers
-- ---------------------------------------------------------------------------

alter table companies
  add column if not exists suspended_at      timestamptz,
  add column if not exists suspension_reason text check (length(suspension_reason) <= 1000);

create index if not exists companies_suspended_idx
  on companies (suspended_at) where suspended_at is not null;

-- A separate guard rather than another clause in guard_company_update(), which
-- has been restated four times already (41, 44, 59) — each restatement is a
-- chance to lose a check. This one only knows about its own two columns.
create or replace function public.guard_company_suspension()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.suspended_at is not null or new.suspension_reason is not null then
      raise exception 'suspension is an admin action';
    end if;
  elsif (new.suspended_at, new.suspension_reason) is distinct from (old.suspended_at, old.suspension_reason) then
    raise exception 'suspension is an admin action';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_company_suspension() from public, anon, authenticated;

drop trigger if exists companies_11_guard_suspension on companies;
create trigger companies_11_guard_suspension
  before insert or update on companies
  for each row execute function public.guard_company_suspension();

-- A suspended company puts nothing in front of a moderator or the public, by
-- any path: the employer's own submit, an admin's approval, a direct write.
-- 15 — after authorisation (10) says who may move the listing, before the post
-- cap (20) and the credit (25), which are questions about a company that is
-- allowed to trade at all.
create or replace function public.refuse_suspended_company_listing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('pending_review', 'active') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if exists (select 1 from companies where id = new.company_id and suspended_at is not null) then
    raise exception 'company_suspended'
      using hint = 'This company is suspended; its listings cannot be submitted or published.';
  end if;

  return new;
end;
$$;

revoke execute on function public.refuse_suspended_company_listing() from public, anon, authenticated;

drop trigger if exists jobs_15_company_suspended on jobs;
create trigger jobs_15_company_suspended
  before insert or update of status on jobs
  for each row execute function public.refuse_suspended_company_listing();

-- ---------------------------------------------------------------------------
-- Consultants: a restriction that outlives the next profile save
-- ---------------------------------------------------------------------------

alter table agent_profiles
  add column if not exists restricted_at      timestamptz,
  add column if not exists restriction_reason text check (length(restriction_reason) <= 1000);

create index if not exists agent_profiles_restricted_idx
  on agent_profiles (restricted_at) where restricted_at is not null;

create or replace function public.guard_agent_restriction()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.restricted_at is not null or new.restriction_reason is not null then
      raise exception 'restriction is an admin action';
    end if;
    return new;
  end if;

  if (new.restricted_at, new.restriction_reason) is distinct from (old.restricted_at, old.restriction_reason) then
    raise exception 'restriction is an admin action';
  end if;

  -- Coerced, not refused: the profile form sends visibility on every save,
  -- and refusing would lock a restricted consultant out of editing anything.
  if old.restricted_at is not null then
    new.visibility := 'hidden';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_agent_restriction() from public, anon, authenticated;

drop trigger if exists agent_profiles_11_guard_restriction on agent_profiles;
create trigger agent_profiles_11_guard_restriction
  before insert or update on agent_profiles
  for each row execute function public.guard_agent_restriction();

-- ---------------------------------------------------------------------------
-- Reports: about a listing, a company or a consultant; and a status
-- ---------------------------------------------------------------------------

alter table reports alter column job_id drop not null;

alter table reports
  add column if not exists company_id uuid references companies on delete cascade,
  add column if not exists agent_id   uuid references agent_profiles on delete cascade,
  add column if not exists status     text not null default 'open';

-- The boolean already said open or closed; nothing recorded whether closing
-- meant "acted on" or "no violation", so every historical close is 'resolved',
-- the value that claims neither.
update reports set status = 'resolved' where resolved and status = 'open';

alter table reports drop constraint if exists reports_status_check;
alter table reports
  add constraint reports_status_check
  check (status in ('open', 'investigating', 'resolved', 'dismissed'));

alter table reports drop constraint if exists reports_one_target;
alter table reports
  add constraint reports_one_target
  check (num_nonnulls(job_id, company_id, agent_id) = 1);

-- The original six, plus what a report about a company or a person needs.
alter table reports drop constraint if exists reports_reason_check;
alter table reports
  add constraint reports_reason_check
  check (reason in (
    'fake_listing', 'misleading_pay', 'duplicate', 'spam', 'discriminatory', 'other',
    'scam', 'impersonation', 'harassment', 'suspicious_company', 'inappropriate'
  ));

alter table reports drop constraint if exists reports_detail_length;
alter table reports add constraint reports_detail_length check (length(detail) <= 1000);

-- One report per person per target, as the listing index already does.
create unique index if not exists reports_one_per_reporter_per_company
  on reports (company_id, reporter_id) where company_id is not null;
create unique index if not exists reports_one_per_reporter_per_agent
  on reports (agent_id, reporter_id) where agent_id is not null;

create index if not exists reports_status_idx on reports (status, created_at desc);
create index if not exists reports_company_idx on reports (company_id) where company_id is not null;
create index if not exists reports_agent_idx on reports (agent_id) where agent_id is not null;

-- `status` is the truth and `resolved` follows it, because existing readers
-- (and the rail badge until migration 316) ask the boolean. A write that only
-- flips the boolean — the old console did exactly that — is translated rather
-- than ignored.
create or replace function public.sync_report_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.resolved is distinct from old.resolved then
    new.status := case when new.resolved then 'resolved' else 'open' end;
  end if;

  new.resolved := new.status in ('resolved', 'dismissed');

  if new.resolved then
    new.resolved_at := coalesce(new.resolved_at, now());
  else
    new.resolved_at := null;
    new.resolved_by := null;
  end if;

  return new;
end;
$$;

revoke execute on function public.sync_report_status() from public, anon, authenticated;

drop trigger if exists reports_05_sync_status on reports;
create trigger reports_05_sync_status
  before insert or update on reports
  for each row execute function public.sync_report_status();

-- The insert policy, restated whole (migration 57's predicate plus the new
-- rules). A report arrives open; a suspended account files none; and nobody
-- reports their own company or their own consultant profile, which is the
-- cheapest way to fill a moderator's morning with noise.
drop policy if exists reports_insert_signed_in on reports;
create policy reports_insert_signed_in on reports
  for insert with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and resolved_by is null
    and exists (
      select 1 from profiles p
       where p.id = (select auth.uid()) and p.approval_status <> 'rejected'
    )
    and (company_id is null or not public.owns_company(company_id))
    and (agent_id is null or not exists (
      select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())
    ))
  );

-- ---------------------------------------------------------------------------
-- Taxonomy: slugs are permanent, and a row in use cannot be deleted
-- ---------------------------------------------------------------------------

create or replace function public.guard_taxonomy_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uses bigint := 0;
begin
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then
      raise exception 'taxonomy_slug_is_permanent'
        using hint = 'A slug is part of public URLs and cannot be changed. Rename the labels instead.';
    end if;
    return new;
  end if;

  -- DELETE
  if tg_table_name = 'districts' then
    v_uses := (select count(*) from jobs where district_id = old.id)
            + (select count(*) from companies where district_id = old.id)
            + (select count(*) from agent_profiles where district_ids @> array[old.id])
            + (select count(*) from agent_experience where district_id = old.id);
  elsif tg_table_name = 'governorates' then
    v_uses := (select count(*) from districts where governorate_id = old.id);
  elsif tg_table_name = 'developers' then
    v_uses := (select count(*) from job_developers where developer_id = old.id)
            + (select count(*) from agent_developers where developer_id = old.id);
  end if;

  if v_uses > 0 then
    raise exception 'taxonomy_in_use'
      using hint = format('Referenced %s time(s); it cannot be deleted without breaking them.', v_uses);
  end if;

  return old;
end;
$$;

revoke execute on function public.guard_taxonomy_change() from public, anon, authenticated;

drop trigger if exists districts_10_guard on districts;
create trigger districts_10_guard
  before update or delete on districts
  for each row execute function public.guard_taxonomy_change();

drop trigger if exists governorates_10_guard on governorates;
create trigger governorates_10_guard
  before update or delete on governorates
  for each row execute function public.guard_taxonomy_change();

drop trigger if exists developers_10_guard on developers;
create trigger developers_10_guard
  before update or delete on developers
  for each row execute function public.guard_taxonomy_change();

-- The district check above scans agent_profiles by array membership, which
-- agent_profiles_districts_idx (migration 02) already serves.

-- ---------------------------------------------------------------------------
-- Search indexes for the console
--
-- The console searches by fragments of a name — "رواد", "hub" — which a
-- btree cannot serve. Trigram indexes let ilike '%fragment%' use an index
-- instead of reading every row, which is what "do not fetch entire tables"
-- means once the tables are no longer small.
-- ---------------------------------------------------------------------------

create index if not exists profiles_full_name_trgm_idx
  on profiles using gin (full_name extensions.gin_trgm_ops);
create index if not exists companies_name_ar_trgm_idx
  on companies using gin (name_ar extensions.gin_trgm_ops);
create index if not exists companies_name_en_trgm_idx
  on companies using gin (name_en extensions.gin_trgm_ops);
create index if not exists jobs_title_ar_trgm_idx
  on jobs using gin (title_ar extensions.gin_trgm_ops);
create index if not exists jobs_title_en_trgm_idx
  on jobs using gin (title_en extensions.gin_trgm_ops);

-- The console lists every table newest-first, filtered by state.
create index if not exists profiles_role_created_idx on profiles (role, created_at desc);
create index if not exists jobs_status_created_idx on jobs (status, created_at desc);
create index if not exists companies_created_idx on companies (created_at desc);
create index if not exists applications_created_idx on applications (created_at desc);
