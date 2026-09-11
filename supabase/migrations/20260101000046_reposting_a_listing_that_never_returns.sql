-- =============================================================================
-- 46 — A repost that puts the listing back on the board it has already left
--
-- stamp_job_publication starts the 30-day window when a listing first becomes
-- active, and preserves it with coalesce on every later entry into `active`.
-- That reads as caution — do not overwrite a date somebody set — and it turns
-- reposting into a no-op that looks like a success:
--
--   closed -> pending_review -> active
--
-- is the only path an employer has back onto the board, and it brings the
-- original expires_at with it. If the window had already run out, the listing
-- returns `active` and already expired: invisible to the public board, which
-- filters on the date, and flipped straight back to `expired` by the next
-- nightly run. The employer closed it, filled the form again, waited for a
-- moderator, and nothing came back. Proven against production on the one
-- listing whose window has passed: republished, expires_at 2026-09-10,
-- would_be_on_the_board false.
--
-- The clause that was meant to prevent this reads `old.status = 'expired'` and
-- has never once fired: guard_job_update permits expired -> pending_review and
-- expired -> closed, never expired -> active, so the last status before
-- `active` is always `pending_review`. Removed rather than repaired, because
-- the rule below covers the case it was reaching for and two rules for one
-- thing is how this happened.
--
-- The rule: entering `active` with a window that has already run out starts a
-- fresh one. A window still running is carried across untouched — a listing
-- closed on day five and reopened on day six keeps its remaining twenty-four,
-- and closing and reopening is not a way to buy another month for free.
--
-- INSERT is deliberately untouched. A row created directly with explicit dates
-- is a seed or a restore stating a fact about the past, and renewing it would
-- rewrite that.
-- =============================================================================

create or replace function public.stamp_job_publication()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.published_at := coalesce(new.published_at, now());
    new.expires_at   := coalesce(new.expires_at, new.published_at + interval '30 days');
  end if;

  -- Reposting: a window that has already run out is renewed, not restored.
  if tg_op = 'UPDATE'
     and new.status = 'active'
     and old.status is distinct from 'active'
     and (new.expires_at is null or new.expires_at <= now())
  then
    new.published_at := now();
    new.expires_at   := now() + interval '30 days';
  end if;

  if new.is_featured and new.featured_until is null then
    new.featured_until := now() + interval '14 days';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The date proves expiry; the nightly job only tidies the label
--
-- Three readers still classified a listing by `status = 'active'` alone, and
-- the difference is not theoretical: SUPABASE_SERVICE_ROLE_KEY is unset on
-- production, so the cron that flips the label returns 503 and has never run.
-- One listing has been `active` with an expiry a day in the past ever since —
-- absent from the public board, which filters on the date, and counted as live
-- by everything here.
--
-- The post cap is the one that costs the employer something. An unverified
-- company may keep one active listing, and a listing nobody can see was
-- filling that slot: they could not post a replacement for the advert that had
-- quietly ended.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_active_post_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status verification_status;
  v_active int;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;                                  -- already counted
  end if;

  select verification_status into v_status from companies where id = new.company_id;

  if v_status <> 'verified' then
    select count(*) into v_active
      from jobs
     where company_id = new.company_id
       and status = 'active'
       -- A listing whose window has run out is not occupying the slot, whether
       -- or not the nightly job has got around to saying so.
       and (expires_at is null or expires_at > now())
       and id <> new.id;

    if v_active >= 1 then
      raise exception 'unverified_company_post_cap'
        using hint = 'Unverified companies may keep only one active job post.';
    end if;
  end if;

  return new;
end;
$$;

-- seats_advertised counted seats on listings nobody can apply to, and the
-- conversion table below ranked them. Restated whole, with live_jobs's own
-- condition — which migration 41 already had right — applied to both.
create or replace function public.employer_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_result  jsonb;
begin
  v_company := public.my_company_id();
  if v_company is null then return jsonb_build_object('has_company', false); end if;

  select jsonb_build_object(
    'has_company', true,
    'live_jobs', count(*) filter (where j.status = 'active' and (j.expires_at is null or j.expires_at > now())),
    'pending_jobs', count(*) filter (where j.status = 'pending_review'),
    'draft_jobs', count(*) filter (where j.status = 'draft'),
    'expiring_soon', count(*) filter (where j.status = 'active' and j.expires_at is not null and j.expires_at between now() and now() + interval '7 days'),
    'total_views', coalesce(sum(j.view_count), 0),
    'seats_advertised', coalesce(sum(j.seats) filter (where j.status = 'active' and (j.expires_at is null or j.expires_at > now())), 0)
  ) into v_result
  from jobs j
  where j.company_id = v_company;

  return v_result || jsonb_build_object(
    'applicants_total',   (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company),
    'applicants_new',     (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.status = 'new'),
    'applicants_unseen',  (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.employer_viewed_at is null),
    'applicants_7d',      (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.created_at > now() - interval '7 days'),
    'applicants_prev_7d', (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.created_at between now() - interval '14 days' and now() - interval '7 days'),
    'credits',            (select post_credits from companies where id = v_company),
    'verification',       (select verification_status::text from companies where id = v_company)
  );
end;
$$;

create or replace function public.employer_trend()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_today   date := (now() at time zone 'Africa/Cairo')::date;
  v_days    jsonb;
  v_conv    jsonb;
begin
  v_company := public.my_company_id();
  if v_company is null then return jsonb_build_object('has_company', false); end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('d', to_char(g.day, 'YYYY-MM-DD'), 'applications', coalesce(c.n, 0))
      order by g.day
    ),
    '[]'::jsonb
  ) into v_days
  from generate_series(v_today - 29, v_today, interval '1 day') as g(day)
  left join (
    select (a.created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
    from applications a
    join jobs j on j.id = a.job_id
    where j.company_id = v_company
      and a.created_at >= ((v_today - 29)::timestamp at time zone 'Africa/Cairo')
    group by 1
  ) c on c.day = g.day::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'title_ar', t.title_ar, 'title_en', t.title_en,
        'views', t.view_count, 'applications', t.applications
      )
      order by t.applications::numeric / nullif(t.view_count, 0) desc nulls last, t.applications desc
    ),
    '[]'::jsonb
  ) into v_conv
  from (
    select j.id, j.slug, j.title_ar, j.title_en, j.view_count,
           (select count(*) from applications a where a.job_id = j.id)::int as applications
    from jobs j
    where j.company_id = v_company
      and j.status = 'active'
      and (j.expires_at is null or j.expires_at > now())
    order by j.published_at desc nulls last
    limit 6
  ) t;

  return jsonb_build_object('has_company', true, 'days', v_days, 'conversion', v_conv);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reposting a listing whose label has not caught up
--
-- The employer console now classifies by the date, so a listing stored as
-- `active` with a window that has run out is shown as expired — and the action
-- beside it is "repost", which sends pending_review. The transition table only
-- allowed that from `expired`, the label the cron writes, so the console would
-- have offered a button the database refuses.
--
-- Permitted from `active` too, but only once the window has actually passed:
-- that row *is* expired, and which of the two labels it happens to carry is a
-- fact about when the cron last ran, not about the listing. Publishing is
-- still a moderation action, and an employer still cannot take a live listing
-- off the board by any route but `closed`.
--
-- Restated whole, as this file's other functions are.
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
