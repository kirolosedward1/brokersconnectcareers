-- =============================================================================
-- 72 — A row says what the server said
--
-- Row-level security decides whether a row may be written. It says almost
-- nothing about which columns the writer chose the values of, and on an INSERT
-- there is no OLD row for a guard to compare against. So a number of columns
-- the platform treats as its own were, on the way in, the client's:
--
--   - a listing's published_at, expires_at, featured_until, view_count and
--     rejection_note. An approved employer could insert a draft dated 2099,
--     have it approved, and hold a listing that never expired, sorted above
--     every other for the rest of time, and (when billing turns on) spent no
--     credit — stamp_job_publication coalesces, and spend_post_credit skips a
--     window with time left;
--   - an application's employer_viewed_at and decision_note, which are the
--     employer's, and its created_at, which is what the rate limit counts;
--   - a report's resolved, resolved_by and resolved_at;
--   - a verification document's review columns, and its storage path, which
--     was not held to the company's own folder the way a CV is held to the
--     candidate's;
--   - created_at on every table with a velocity rule.
--
-- This migration stamps them. A BEFORE INSERT trigger on each table sets the
-- server's columns to the server's values for anyone who is not acting as
-- admin, so a client may send what it likes and the row records what is true.
--
-- Four more rules of the same kind:
--
-- A live listing's district, track, employment type and experience band now
-- count as material changes, sending an edit back to review the way pay and
-- title already did, and its slug is frozen. A listing approved for New Cairo
-- and moved to another city afterwards is a different listing wearing an
-- approval.
--
-- A storage path is `<owner>/<file>` and nothing else — no further slashes, no
-- `..`, no encoded characters. The prefix checks in the application compared
-- strings, and the storage client sends paths without encoding them, so a path
-- of `<me>/../<someone>/cv.pdf` passed the prefix test and named another
-- folder. Random file names made it unexploitable in practice; the shape rule
-- makes it impossible.
--
-- An account belongs to one company. A company admin could add any employer
-- account to their team, uninvited, and because my_company_id() prefers an
-- admin membership, the victim's console silently started acting for the
-- attacker's company. There is no invitation flow yet; until there is, a
-- membership elsewhere refuses the insert, and the people who can still be
-- added are the people who have not joined anyone.
--
-- Links are https. companies.website accepted any URL a parser would call a
-- URL, which includes `javascript:` — and the company page rendered it as a
-- link. Checked here as data, and re-checked wherever it is rendered.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The server's columns
-- ---------------------------------------------------------------------------

create or replace function public.stamp_created_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.acting_as_admin() then
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_created_at() from public, anon, authenticated;

-- One trigger per table, named to run before the rules that count rows.
create trigger applications_05_stamp   before insert on applications      for each row execute function public.stamp_created_at();
create trigger reports_05_stamp        before insert on reports           for each row execute function public.stamp_created_at();
create trigger jobs_02_stamp           before insert on jobs              for each row execute function public.stamp_created_at();
create trigger profiles_02_stamp       before insert on profiles          for each row execute function public.stamp_created_at();
create trigger companies_05_stamp      before insert on companies         for each row execute function public.stamp_created_at();
create trigger company_documents_05_stamp before insert on company_documents for each row execute function public.stamp_created_at();
create trigger saved_searches_05_stamp before insert on saved_searches    for each row execute function public.stamp_created_at();
create trigger saved_agents_05_stamp   before insert on saved_agents      for each row execute function public.stamp_created_at();
create trigger agent_profiles_05_stamp before insert on agent_profiles    for each row execute function public.stamp_created_at();
create trigger application_notes_05_stamp before insert on application_notes for each row execute function public.stamp_created_at();

create or replace function public.guard_job_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  new.published_at   := null;
  new.expires_at     := null;
  new.featured_until := null;
  new.is_featured    := false;
  new.view_count     := 0;
  new.rejection_note := null;
  new.version        := 1;

  return new;
end;
$$;

revoke execute on function public.guard_job_insert() from public, anon, authenticated;

create trigger jobs_03_guard_insert
  before insert on jobs
  for each row execute function public.guard_job_insert();

create or replace function public.guard_application_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  new.employer_viewed_at := null;
  new.decision_note      := null;

  return new;
end;
$$;

revoke execute on function public.guard_application_insert() from public, anon, authenticated;

create trigger applications_03_guard_insert
  before insert on applications
  for each row execute function public.guard_application_insert();

create or replace function public.guard_report_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  new.resolved    := false;
  new.resolved_by := null;
  new.resolved_at := null;

  return new;
end;
$$;

revoke execute on function public.guard_report_insert() from public, anon, authenticated;

create trigger reports_03_guard_insert
  before insert on reports
  for each row execute function public.guard_report_insert();

create or replace function public.guard_company_document_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  new.review_note := null;
  new.reviewed_by := null;
  new.reviewed_at := null;

  return new;
end;
$$;

revoke execute on function public.guard_company_document_insert() from public, anon, authenticated;

create trigger company_documents_03_guard_insert
  before insert on company_documents
  for each row execute function public.guard_company_document_insert();

-- A company's own clock and verification stamp are not the owner's to set.
create or replace function public.guard_company_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  new.verified_at := null;
  new.version     := 1;

  return new;
end;
$$;

revoke execute on function public.guard_company_insert() from public, anon, authenticated;

create trigger companies_03_guard_insert
  before insert on companies
  for each row execute function public.guard_company_insert();

-- ---------------------------------------------------------------------------
-- A live listing changes under review, or it does not change
-- ---------------------------------------------------------------------------

create or replace function public.guard_job_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ok boolean;
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception 'a job cannot be moved between companies';
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'a listing slug is permanent — links point at it';
  end if;
  if new.is_featured is distinct from old.is_featured then
    raise exception 'featured placement is granted by billing, not by the owner';
  end if;
  if new.view_count is distinct from old.view_count then
    raise exception 'view_count is not owner-writable';
  end if;
  if (new.published_at, new.expires_at, new.featured_until)
     is distinct from (old.published_at, old.expires_at, old.featured_until) then
    raise exception 'the posting window is stamped at publication, not set by the owner';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not owner-writable';
  end if;
  if new.rejection_note is distinct from old.rejection_note then
    raise exception 'rejection_note is written by review';
  end if;

  if new.status is distinct from old.status then
    ok := case old.status
      when 'draft'          then new.status in ('draft', 'pending_review')
      when 'pending_review' then new.status in ('draft', 'pending_review')
      when 'active'         then new.status = 'closed'
                                 or (new.status = 'pending_review'
                                     and old.expires_at is not null
                                     and old.expires_at <= now())
      when 'expired'        then new.status in ('pending_review', 'closed')
      when 'closed'         then new.status = 'pending_review'
      when 'rejected'       then new.status in ('draft', 'pending_review')
      else false
    end;

    if not ok then
      raise exception 'job status cannot go from % to %', old.status, new.status
        using hint = 'Publishing is a moderation action.';
    end if;
  end if;

  -- Editing a live post sends it back for review rather than silently changing
  -- what was already approved. Migration 66's eight fields, plus the four that
  -- turn one listing into another: where it is, which track, what kind of
  -- contract, and how senior. Requirements, translations, benefits and the
  -- commission note stay cosmetic — a typo fix there should not cost a day
  -- off the board.
  if old.status = 'active' and new.status = 'active'
     and (new.title_ar, new.description_ar, new.basic_salary_min, new.basic_salary_max,
          new.commission_type, new.commission_value, new.leads_source, new.seats,
          new.district_id, new.track, new.employment_type, new.experience_band)
      is distinct from
         (old.title_ar, old.description_ar, old.basic_salary_min, old.basic_salary_max,
          old.commission_type, old.commission_value, old.leads_source, old.seats,
          old.district_id, old.track, old.employment_type, old.experience_band)
  then
    new.status := 'pending_review';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The shape of a storage path
-- ---------------------------------------------------------------------------

alter table applications
  drop constraint if exists applications_cv_is_the_applicants;
alter table applications
  add constraint applications_cv_is_the_applicants
  check (cv_path is null or cv_path ~ ('^' || candidate_id::text || '/[A-Za-z0-9._-]{1,160}$'))
  not valid;

alter table agent_profiles
  drop constraint if exists agent_profiles_cv_is_the_owners;
alter table agent_profiles
  add constraint agent_profiles_cv_is_the_owners
  check (cv_path is null or cv_path ~ ('^' || user_id::text || '/[A-Za-z0-9._-]{1,160}$'))
  not valid;

alter table company_documents
  add constraint company_documents_path_is_the_companys
  check (storage_path ~ ('^' || company_id::text || '/[A-Za-z0-9._-]{1,160}$'))
  not valid;

-- ---------------------------------------------------------------------------
-- Links are https, and bounded
-- ---------------------------------------------------------------------------

alter table companies
  add constraint companies_website_is_http
  check (website is null or website ~* '^https?://[^\s]{1,190}$')
  not valid;

alter table companies
  add constraint companies_logo_url_is_https
  check (logo_url is null or (logo_url ~* '^(https://|http://(localhost|127\.0\.0\.1)[:/])[^\s]+$' and length(logo_url) <= 512))
  not valid;

alter table profiles
  add constraint profiles_avatar_url_is_https
  check (avatar_url is null or (avatar_url ~* '^(https://|http://(localhost|127\.0\.0\.1)[:/])[^\s]+$' and length(avatar_url) <= 512))
  not valid;

-- ---------------------------------------------------------------------------
-- Bounds that were missing
-- ---------------------------------------------------------------------------

alter table agent_profiles
  add constraint agent_profiles_tracks_bounded    check (coalesce(array_length(tracks, 1), 0) <= 6) not valid,
  add constraint agent_profiles_districts_bounded check (coalesce(array_length(district_ids, 1), 0) <= 20) not valid,
  add constraint agent_profiles_languages_bounded check (coalesce(array_length(languages, 1), 0) <= 6) not valid;

alter table reports
  add constraint reports_detail_length check (detail is null or length(detail) <= 1000) not valid;

alter table jobs
  add constraint jobs_rejection_note_length check (rejection_note is null or length(rejection_note) <= 500) not valid;

alter table company_documents
  add constraint company_documents_review_note_length check (review_note is null or length(review_note) <= 500) not valid;

-- Validate what can be validated. A legacy row that fails leaves the
-- constraint in place for every new write and is reported rather than
-- blocking the migration; the notice names it for cleanup.
do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
      from pg_constraint
     where connamespace = 'public'::regnamespace
       and not convalidated
  loop
    begin
      execute format('alter table %s validate constraint %I', c.tbl, c.conname);
    exception when others then
      raise notice 'constraint % on % left NOT VALID: %', c.conname, c.tbl, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- One company per account
-- ---------------------------------------------------------------------------

create or replace function public.guard_company_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_role  user_role;
begin
  select owner_id into v_owner
    from companies where id = coalesce(new.company_id, old.company_id);

  if tg_op = 'DELETE' and old.user_id = v_owner then
    raise exception 'company_owner_membership'
      using hint = 'The owner cannot be removed from their own company.';
  end if;

  if tg_op = 'UPDATE' and old.user_id = v_owner and new.role <> 'admin' then
    raise exception 'company_owner_membership'
      using hint = 'The owner is always an admin of their own company.';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select role into v_role from profiles where id = new.user_id;
    if v_role = 'candidate' then
      raise exception 'company_member_role'
        using hint = 'Only an employer account can be added to a company.';
    end if;
  end if;

  -- Uninvited, and already somewhere else: refused. Admins keep the escape
  -- hatch for a genuine transfer.
  if tg_op = 'INSERT' and not public.acting_as_admin()
     and exists (
       select 1 from company_members m
        where m.user_id = new.user_id and m.company_id <> new.company_id
     )
  then
    raise exception 'company_member_elsewhere'
      using hint = 'This account already belongs to another company.';
  end if;

  return coalesce(new, old);
end;
$$;
