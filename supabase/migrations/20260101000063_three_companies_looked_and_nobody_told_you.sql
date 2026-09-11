-- =============================================================================
-- 63 — Three companies looked at your profile and nobody told you
--
-- A consultant who fills in a directory profile gets no signal that it is
-- working. `jobs.view_count` exists for listings, so an employer can see their
-- advert being read; the other side of the market has nothing. The one number
-- that would bring somebody back to finish their profile — somebody is
-- looking — is the number this platform did not keep.
--
-- ---------------------------------------------------------------------------
-- Counted, never estimated
-- ---------------------------------------------------------------------------
-- The tempting shortcut is a counter on agent_profiles incremented on every
-- page load, the way increment_job_view works. It would be wrong in three
-- ways at once: the owner's own previews would inflate it (migration 40 gave
-- them a preview link, so they have a reason to load it), one employer
-- refreshing twice would read as two companies, and anonymous traffic — which
-- is most of it, and not hiring anybody — would be mixed in with the signal.
-- A profile showing "47 views" that means "somebody pressed reload" is worse
-- than no number, because the consultant would act on it.
--
-- So a log, with the deduplication in the primary key: one row per consultant
-- per company per day. What it can answer is exactly the sentence it is shown
-- as — how many companies opened your profile — and nothing more. Cairo's day
-- boundary rather than UTC, because "today" for everybody involved is Cairo,
-- and employer_trend() already draws its chart that way.
--
-- Only employers are logged. Not as an oversight: the useful question for a
-- consultant is whether people who hire are looking, and folding in
-- signed-out traffic would turn an honest count into a vanity metric that
-- cannot be acted on.
--
-- ---------------------------------------------------------------------------
-- What each side may see
-- ---------------------------------------------------------------------------
-- The consultant sees a count, over a window, and never an identity. That is
-- the whole of it: "three companies" is useful, "شركة الرواد looked at you on
-- Tuesday" is a different product with different consequences, and it is not
-- this one's to introduce quietly as a side effect of adding a counter.
--
-- So the table has no SELECT policy at all. Nobody reads rows — not the
-- consultant, not the company that wrote them, not through PostgREST. The one
-- way to a number is candidate_summary(), which aggregates the caller's own
-- and returns an integer. A table nobody can read is easier to reason about
-- than a table with a careful policy on it.
-- =============================================================================

create table if not exists agent_profile_views (
  agent_id   uuid not null references agent_profiles on delete cascade,
  company_id uuid not null references companies on delete cascade,
  day        date not null,

  -- The deduplication, as the key rather than as a rule somebody has to
  -- remember. A second look on the same day is the same look.
  primary key (agent_id, company_id, day)
);

-- The read this exists for: one consultant's rows inside a window. The primary
-- key leads on agent_id, so it already serves that — this one carries the date
-- so the window is a range scan rather than a filter on every row of theirs.
create index if not exists agent_profile_views_agent_day_idx
  on agent_profile_views (agent_id, day desc);

-- The other foreign key, for the delete side: removing a company takes its
-- rows with it, and without this that is a sequential scan per company.
create index if not exists agent_profile_views_company_idx
  on agent_profile_views (company_id);

alter table agent_profile_views enable row level security;

-- No policies. Deliberately: see the header. Row-level security with no
-- policy denies everything, which is the intent — the only routes in and out
-- are the two definer functions below.

-- ---------------------------------------------------------------------------
-- The write
-- ---------------------------------------------------------------------------
-- Takes a slug, because the page has one and the caller should not be handing
-- over an internal id it had to look up. Resolves everything else itself:
-- which company the caller acts for, whether the profile exists, and whether
-- the caller is its owner.
--
-- Silent on every refusal. A signed-out reader, a candidate, an employer with
-- no company, a consultant looking at their own card, a slug that matches
-- nothing — all of them return without a row and without an error, because
-- none of them is a failure the page should hear about, and the page calls
-- this in `after()` where nobody is listening anyway.
-- ---------------------------------------------------------------------------

create or replace function public.record_agent_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent   uuid;
  v_owner   uuid;
  v_company uuid;
begin
  v_company := public.my_company_id();
  if v_company is null then return; end if;

  select a.id, a.user_id into v_agent, v_owner
    from agent_profiles a
   where a.slug = p_slug;

  if v_agent is null then return; end if;

  -- Their own preview is not a view. They have a link to it.
  if v_owner = (select auth.uid()) then return; end if;

  insert into agent_profile_views (agent_id, company_id, day)
  values (v_agent, v_company, (now() at time zone 'Africa/Cairo')::date)
  on conflict do nothing;

  /*
    Retention, here rather than in a cron.

    Only the last thirty days are ever counted, so anything older is a record
    of who looked at whom that the product has no use for — and the privacy
    policy now says it is deleted. A scheduled job would be the usual place,
    except the four this platform already has need a service-role key
    production does not have, so a fifth would be a promise that does not run.
    This runs on the write, which is the only moment the rows in question are
    provably reachable.

    Sixty rather than thirty: the count is a window and the cleanup is a
    floor, and putting the floor at the edge of the window would mean a row
    could be deleted the same day it stopped being counted, which makes the
    two numbers look like one rule that is off by a day.

    Scoped to this consultant, so it never walks the table. A consultant
    nobody looks at again keeps whatever they had — which is the honest limit
    of doing it this way, and it is bounded by the last time anyone looked.
  */
  delete from agent_profile_views
   where agent_id = v_agent
     and day < (now() at time zone 'Africa/Cairo')::date - 60;
end;
$$;

revoke execute on function public.record_agent_view(text) from public, anon;
grant  execute on function public.record_agent_view(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The read, folded into the dashboard's one round trip
-- ---------------------------------------------------------------------------
-- `profile_views_30d` is the count of distinct companies, which the primary
-- key already guarantees per day — so a company that looked on three separate
-- days is three rows and must be counted once. count(distinct company_id),
-- not count(*).
--
-- Restated whole, because `create or replace` replaces the whole function.
-- This is migration 13's body with one key added and the search_path it was
-- given there.
-- ---------------------------------------------------------------------------

create or replace function public.candidate_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'applications_total',    (select count(*) from applications where candidate_id = auth.uid()),
    'applications_new',      (select count(*) from applications where candidate_id = auth.uid() and status = 'new'),
    'applications_moved',    (select count(*) from applications where candidate_id = auth.uid() and status <> 'new'),
    'applications_hired',    (select count(*) from applications where candidate_id = auth.uid() and status = 'hired'),
    -- A reply is the thing a candidate is actually waiting for: an employer
    -- who moved them, or wrote a reason.
    'replies',               (select count(*) from applications
                               where candidate_id = auth.uid()
                                 and (status <> 'new' or decision_note is not null)),
    'saved_jobs',            (select count(*) from saved_jobs where candidate_id = auth.uid()),
    'saved_searches',        (select count(*) from saved_searches where candidate_id = auth.uid()),
    'alerts_on',             (select count(*) from saved_searches where candidate_id = auth.uid() and alerts),
    'profile_completeness',  coalesce(
                               (select public.profile_completeness(a.id)
                                  from agent_profiles a where a.user_id = auth.uid()), 0),
    'has_profile',           exists (select 1 from agent_profiles where user_id = auth.uid()),
    -- Companies, not visits. The log holds one row per company per day, so a
    -- brokerage that came back on Thursday is two rows and one company.
    'profile_views_30d',     coalesce((
                               select count(distinct v.company_id)
                                 from agent_profile_views v
                                 join agent_profiles a on a.id = v.agent_id
                                where a.user_id = auth.uid()
                                  and v.day >= ((now() at time zone 'Africa/Cairo')::date - 30)
                             ), 0),
    -- Live roles matching any saved search's district, as a rough "worth
    -- looking today" signal. Deliberately coarse: the exact per-search count
    -- belongs to the weekly digest, which already computes it.
    'open_jobs',             (select count(*) from jobs
                               where status = 'active'
                                 and (expires_at is null or expires_at > now()))
  );
$$;

revoke execute on function public.candidate_summary() from public, anon;
grant  execute on function public.candidate_summary() to authenticated, service_role;
