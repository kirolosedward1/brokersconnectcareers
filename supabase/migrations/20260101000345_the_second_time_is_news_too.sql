-- =============================================================================
-- 345 — The second time is news too
--
-- Three notices that went quiet when they mattered most, found by a review of
-- the server's side of the bell and the email:
--
--  1. A move was announced once per stage, ever. The bell's key was the
--     application and the stage, so rejected → reconsidered → interviewed →
--     rejected told the candidate nothing the second time: their last word
--     from us still said "interview". A move is news now unless the last
--     stage they were told is this one — shortlisted → new → shortlisted is
--     still one notice, an employer tidying their board — and each time a
--     stage is told again it has a key of its own, counted from
--     application_events. The first keeps the key it always had. (The email
--     follows the same rule: src/lib/application-arrival.ts.)
--  2. "Request changes" on a company's verification rang no bell: the trigger
--     announced verified and rejected only, and a review that asked for new
--     papers moves the company to unverified. It does now, keyed per version
--     like a refusal — but only for a reviewer's decision, not for a company
--     that took its own papers back.
--  3. The daily "finish your profile" reminder asked for the fifty oldest
--     incomplete profiles, whether or not they had asked for the reminder
--     (opt-in since 337) or had already been sent it (its key is held for 180
--     days). The run was filled with people it then skipped, and somebody who
--     had asked was reached weeks late, or never. It lists only those who
--     asked and have not been told.
--  4. A company could not take back the last paper it had sent for review.
--     company_documents_delete allows it while nobody has looked, and the
--     documents' trigger moves the company back out of the queue — which the
--     company's own update guard refused, so the delete failed. Found by the
--     test for (2).
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: restate on_application_moved() from migration 301, on_company_verified() from migration 301, incomplete_candidate_profiles(int) from migration 28, and guard_company_update() from migration 344
-- safety: ships-with-code — the functions keep their signatures and triggers; the website's cron reads the reminder list as before, only shorter, and a stage keeps its old key the first time it is told, so the only notices added are the ones that were being swallowed

-- ---------------------------------------------------------------------------
-- 1. A stage told again is news; a board being tidied is not
-- ---------------------------------------------------------------------------

create or replace function public.on_application_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job       record;
  v_before    bigint;
  v_last_told application_status;
  v_told      bigint;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- `new` is where an application starts, not a decision anybody made. Moving
  -- one back to it is an employer tidying their board, and "your application
  -- is now: new" is noise at best and a false hope at worst.
  if new.status = 'new' then
    return new;
  end if;

  begin
    /*
      What the candidate has been told: the stages this application reached
      before this move, without `new`, and a stage that follows itself told
      once. The history runs to the arrival at the stage it is leaving —
      read that way rather than "everything recorded so far", so it does not
      matter whether the trigger that records this move
      (applications_record_event) has run yet.
    */
    select max(e.id) into v_before
      from application_events e
     where e.application_id = new.id and e.to_status = old.status;

    select e.to_status into v_last_told
      from application_events e
     where e.application_id = new.id and e.to_status <> 'new' and e.id <= v_before
     order by e.id desc
     limit 1;

    -- Their last word from us already says this: shortlisted → new →
    -- shortlisted is a board being tidied, not news.
    if v_last_told is not distinct from new.status then
      return new;
    end if;

    -- How many times this stage has been told before. Rejected →
    -- shortlisted → rejected is the second rejection, and has to reach them:
    -- keyed on the stage alone it was swallowed, and their last word from us
    -- still said "shortlisted".
    select count(*) into v_told
      from (
        select e.to_status, lag(e.to_status) over (order by e.id) as before
          from application_events e
         where e.application_id = new.id and e.to_status <> 'new' and e.id <= v_before
      ) told
     where told.to_status = new.status and told.before is distinct from told.to_status;

    select j.title_ar, j.title_en, j.slug into v_job from jobs j where j.id = new.job_id;

    perform public.notify(
      new.candidate_id,
      'application_moved',
      jsonb_build_object(
        'status',   new.status::text,
        'title_ar', v_job.title_ar,
        'title_en', v_job.title_en,
        'slug',     v_job.slug,
        'note',     new.decision_note
      ),
      '/dashboard/applications',
      -- The first time a stage is told keeps the key it always had, so
      -- nothing told before this migration is told again; later times are
      -- numbered from 2, as the email's are.
      'application_moved:' || new.id || ':' || new.status::text
        || case when v_told > 0 then ':' || (v_told + 1)::text else '' end
    );
  exception when others then
    raise warning 'notification for application % move failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A review that asks for changes rings the bell
-- ---------------------------------------------------------------------------

create or replace function public.on_company_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is not distinct from old.verification_status then
    return new;
  end if;

  begin
    if new.verification_status = 'verified' then
      perform public.notify_company(
        new.id,
        'company_verified',
        jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
        '/employer/company',
        -- Once ever, like the email: a badge that flaps is not news twice.
        'company_verified:' || new.id
      );
    elsif new.verification_status = 'rejected'
       -- A reviewer sending the papers back for changes: the company is the
       -- one who has to act, exactly as after a refusal. Asked of the review
       -- (is_admin), because a company withdrawing its own last paper takes
       -- the same path back to unverified and needs telling nothing.
       or (new.verification_status = 'unverified' and old.verification_status = 'pending'
           and public.is_admin())
    then
      perform public.notify_company(
        new.id,
        'company_verification_needed',
        jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
        '/employer/company',
        -- Per version: each refusal can carry a different reason.
        'company_verification_needed:' || new.id || ':' || new.version
      );
    end if;
  exception when others then
    raise warning 'notification for company % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The profile reminder, for those who asked and have not been told
-- ---------------------------------------------------------------------------

create or replace function public.incomplete_candidate_profiles(p_limit integer default 50)
returns table(user_id uuid)
language sql
security definer
set search_path = public
as $$
  select p.id
    from profiles p
    left join agent_profiles a on a.user_id = p.id
   where p.role = 'candidate'
     and p.created_at < now() - interval '3 days'
     and p.created_at > now() - interval '30 days'
     -- Asked for (337: off unless switched on), and not already sent — the
     -- email's key is held, so anybody else in the list is skipped by the
     -- sender and takes the place of somebody who is waiting.
     and coalesce(p.notify_profile_nudge, false)
     and not exists (
       select 1 from email_log e where e.dedupe_key = 'profile_incomplete:' || p.id::text
     )
     and (a.id is null or public.profile_completeness(a.id) < 60)
   order by p.created_at
   limit least(greatest(p_limit, 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- 4. A paper nobody has reviewed can be taken back
-- ---------------------------------------------------------------------------

create or replace function public.guard_company_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then return new; end if;

  -- The public address of the company. Permanent, because other people's
  -- links and other people's saved rows point at it.
  if new.slug is distinct from old.slug then
    raise exception 'a company slug is permanent — links and follows point at it';
  end if;

  -- Verification is set by review, with one exception below it.
  if new.verification_status is distinct from old.verification_status then
    -- Submitting papers is a transition the company makes, and so is taking
    -- them back: company_review_state (migration 44) moves a company out of
    -- the queue when its last paper waiting for review is withdrawn, which
    -- company_documents_delete allows — and this refused it, so the paper
    -- could not be taken back at all. Both only under the marker that
    -- trigger sets, so neither can become a way to arrive at `verified`.
    if not (
      coalesce(current_setting('app.submitting_for_review', true), 'off') = 'on'
      and (
        (new.verification_status = 'pending' and old.verification_status in ('unverified', 'rejected'))
        or (new.verification_status = 'unverified' and old.verification_status = 'pending')
      )
    ) then
      raise exception 'verification_status is set by review, not by the owner';
    end if;
  end if;

  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by review, not by the owner';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'company ownership cannot be transferred';
  end if;
  -- A company's age is a review signal ("new company"); backdating it hid one.
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not owner-writable';
  end if;

  -- Credits move only when platform code says it is granting them. The marker
  -- is transaction-local and set inside a SECURITY DEFINER function; a client
  -- speaking to PostgREST has no statement with which to set it.
  if new.post_credits is distinct from old.post_credits
     and coalesce(current_setting('app.granting_credits', true), 'off') <> 'on' then
    raise exception 'post_credits is set by billing, not by the owner';
  end if;

  return new;
end;
$$;
