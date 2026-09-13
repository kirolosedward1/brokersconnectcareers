-- =============================================================================
-- 66 — A balance that only ever went up
--
-- companies.post_credits has two grant paths and no spend path. settle_order()
-- adds what an order bought; claim_monthly_free_post() adds the verified
-- company's one a month; every write in the schema is `post_credits + n`.
-- Publishing never read it. The billing page shows the number, so an employer
-- could buy a pack, watch the figure go up, and discover that the figure was
-- the whole product: posting was free, and the only thing standing between an
-- unverified company and the board was the one-live-listing cap.
--
-- The rule, settled with the owner rather than inferred from the schema:
--
--   who     everyone, verified included. Verification buys the cap exemption
--           and the monthly free post; it does not buy free publishing.
--   when    the moderator's approval — the entry into `active`. Nothing is
--           held at submission, so a rejected listing has cost nothing and
--           there is no refund path to get wrong.
--   what    a new 30-day window. Not "a publication", because two of those
--           are the same posting: a live listing edited back through review,
--           and a listing closed on day five and reopened on day six. Both
--           come back with time still on the clock, and migration 46 already
--           decided that such a window is carried across rather than renewed —
--           "closing and reopening is not a way to buy another month for
--           free". This charges for exactly what that renews, which makes the
--           same sentence true in the other direction: it is not a way to be
--           charged twice for the month you already have.
--   repost  falls out of the above with nothing added. A repost is the one
--           case where the window has run out, so it starts a new one, so it
--           costs a credit. Roadmap item 05 was blocked on this question; it
--           did not need its own mechanism, it needed this one to exist.
--
-- Off by default. BILLING_ENABLED is false, so startCheckout() refuses every
-- purchase and the only obtainable credit today is the verified monthly one —
-- enforcing this on deploy would stop unverified companies publishing at all
-- and cut verified companies to one listing a month. The switch below is the
-- deploy-time behaviour, and flipping it is a decision someone makes on
-- purpose, on the day billing opens, in one statement:
--
--   update app_settings set credits_required = true;
-- =============================================================================

create table if not exists app_settings (
  -- One row, enforced by the column: `check (id)` admits only true, and the
  -- primary key admits it once.
  id               boolean primary key default true check (id),
  credits_required boolean not null default false
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Readable by anyone: it is a fact about how the product is priced, and the
-- employer console needs it to say whether a listing will cost a credit.
drop policy if exists app_settings_select_all on app_settings;
create policy app_settings_select_all on app_settings for select using (true);

drop policy if exists app_settings_admin_all on app_settings;
create policy app_settings_admin_all on app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- The spend
--
-- SECURITY DEFINER for the same reason settle_order() is: post_credits is
-- guarded against its own owner by guard_company_update(), and the moderator
-- approving the listing is not the company. It sets migration 41's
-- transaction-local marker so the guard reads the write as billing rather than
-- as an employer editing their own row — the marker is set inside a definer
-- function and a client speaking to PostgREST has no statement with which to
-- set it.
--
-- UPDATE only, deliberately, for the reason migration 46 gives for leaving
-- INSERT alone: employers may only insert `draft` or `pending_review`, so a
-- row created directly as `active` is a seed or a restore stating a fact about
-- the past, and charging for it would bill a company for its own history.
-- ---------------------------------------------------------------------------

create or replace function public.spend_post_credit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_required boolean;
  v_spent    integer;
begin
  -- An entry into `active`, not a stay in it.
  if new.status <> 'active' or old.status is not distinct from 'active' then
    return new;
  end if;

  -- ...that starts a new window. A listing coming back with time left is the
  -- same posting: stamp_job_publication carries its window across untouched,
  -- and nothing is being sold.
  if old.expires_at is not null and old.expires_at > now() then
    return new;
  end if;

  select credits_required into v_required from app_settings;
  if not coalesce(v_required, false) then
    return new;
  end if;

  perform set_config('app.granting_credits', 'on', true);
  update companies
     set post_credits = post_credits - 1
   where id = new.company_id
     and post_credits > 0;
  -- Counted before the marker is cleared: PERFORM sets FOUND too, so reading
  -- FOUND after it asks whether set_config returned a row, which it always does.
  get diagnostics v_spent = row_count;
  perform set_config('app.granting_credits', 'off', true);

  -- The `post_credits > 0` predicate rather than the column's own
  -- `check (post_credits >= 0)`: a company at zero should hear what it ran out
  -- of, not a constraint name.
  if v_spent = 0 then
    raise exception 'insufficient_post_credits'
      using hint = 'This company has no post credits left.';
  end if;

  return new;
end;
$$;

-- 25: after the post cap (20), so a company that is over its cap *and* out of
-- credits is told about the cap — the cheaper problem, and the one the
-- moderator can do something about. Before the stamp (30), which is where the
-- window this pays for is written.
drop trigger if exists jobs_25_spend_post_credit on jobs;
create trigger jobs_25_spend_post_credit
  before update on jobs
  for each row execute function public.spend_post_credit();

-- Migration 07's standard, repeated here because Supabase grants EXECUTE to
-- anon and authenticated as the function is created and a revoke from `public`
-- does not touch those explicit grants. Nothing calls a trigger function by
-- name.
revoke execute on function public.spend_post_credit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The window becomes money, so the window stops being owner-writable
--
-- guard_job_update() protects company_id, is_featured and view_count, and has
-- never protected published_at or expires_at. Until now that was harmless:
-- both are stamped by stamp_job_publication and no code path in the
-- application writes either column, so the hole had nobody standing in it. A
-- credit priced per 30-day window puts somebody there — `update jobs set
-- expires_at = now() + interval '1 year'` is a free renewal, available to any
-- employer with their own listing's id, and it bypasses the rule above
-- entirely rather than bending it.
--
-- Restated whole, as migration 46 restated it, and keeping its SET clause:
-- CREATE OR REPLACE without one removes the pinned search_path, which is the
-- exact way migration 46 lost stamp_job_publication's.
-- ---------------------------------------------------------------------------

create or replace function public.guard_job_update()
returns trigger
language plpgsql
set search_path = public
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
  if new.is_featured is distinct from old.is_featured then
    raise exception 'featured placement is granted by billing, not by the owner';
  end if;
  if new.view_count is distinct from old.view_count then
    raise exception 'view_count is not owner-writable';
  end if;
  if (new.published_at, new.expires_at) is distinct from (old.published_at, old.expires_at) then
    raise exception 'the posting window is stamped at publication, not set by the owner';
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
  -- what was already approved.
  if old.status = 'active' and new.status = 'active'
     and (new.title_ar, new.description_ar, new.basic_salary_min, new.basic_salary_max,
          new.commission_type, new.commission_value, new.leads_source, new.seats)
      is distinct from
         (old.title_ar, old.description_ar, old.basic_salary_min, old.basic_salary_max,
          old.commission_type, old.commission_value, old.leads_source, old.seats)
  then
    new.status := 'pending_review';
  end if;

  return new;
end;
$$;
