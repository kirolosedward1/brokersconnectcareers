-- =============================================================================
-- 62 — The advert ran out and the dashboard went quiet about it
--
-- Every listing carries expires_at, so every listing ends. When one does, the
-- console says nothing: `live_jobs` drops by one, `expiring_soon` stops
-- counting it — it counts listings about to end, not ones that have — and the
-- next-action card moves on to whatever is next. The employer's operation
-- simply gets smaller with nothing anywhere saying why or what to do.
--
-- The way back has existed since migration 46 fixed it: "reopen" on the
-- listing row sends it to review, and entering `active` with a window that has
-- already run out starts a fresh thirty days. What has been missing is anyone
-- telling the employer their advert is gone — and on a board this size, the
-- listing that quietly disappeared is the difference between a company that
-- keeps hiring here and one that does not come back.
--
-- `ended_jobs` counts what can be put back, by the same rule the console
-- already renders by:
--
--   status in ('expired', 'closed')
--   or (status = 'active' and expires_at <= now())
--
-- The second disjunct is not defensive. The nightly cron that relabels an
-- expired listing needs a service-role key that is not configured on
-- production, so listings sit at `active` with a window that closed days ago;
-- jobIsLive() and displayJobStatus() have compensated for that in the
-- interface since round 3, and a summary that trusted the label would put a
-- number on this card that the page behind it contradicts.
--
-- `rejected` is excluded. That listing needs editing, not reposting, and the
-- rejection note on its row says so in the reviewer's own words.
--
-- Restated whole, because `create or replace` replaces the whole function:
-- this carries migration 46's body — which is 41's, which is 36's — with one
-- filter added. Writing only the new line would silently drop the membership
-- lookup, the applicant counts and the search_path, which is a mistake this
-- schema has made three times.
-- =============================================================================

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
    -- Ended, and therefore repostable. The date as well as the label, for the
    -- reason in the header.
    'ended_jobs', count(*) filter (
      where j.status in ('expired', 'closed')
         or (j.status = 'active' and j.expires_at is not null and j.expires_at <= now())
    ),
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
