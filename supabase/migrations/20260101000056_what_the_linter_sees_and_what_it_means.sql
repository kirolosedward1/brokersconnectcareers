-- =============================================================================
-- 56 — Three answers to the database linter, one of which is a fix
--
-- Supabase's advisors report 41 findings against this schema. Thirty-eight of
-- them are the shape of the schema rather than defects in it, and one is a
-- real if small leak. Left as a wall of warnings, the real one is invisible;
-- so all three kinds are settled here, in the places a reader will look.
--
-- 1. profile_completeness() was callable by any signed-in account for any
--    consultant's id, and answered. It is a number about somebody else's
--    profile — including a profile set to `hidden`, which is precisely the one
--    whose owner asked not to be visible. Small: it confirms an id exists and
--    says roughly how filled in it is. Free to close: the only two callers are
--    /dashboard/profile asking about the viewer's own profile, and
--    candidate_summary(), which computes it for the caller.
--
-- 2. email_log and email_suppressions have RLS enabled and no policies, which
--    the linter reports as a gap. It is the opposite: no policy is how you say
--    "service role only", and both tables are exactly that. Written down on
--    the tables themselves so that the next person to meet the warning does
--    not close it by adding a policy.
--
-- 3. Thirty-eight SECURITY DEFINER functions are callable over the API. Three
--    are meant to be — the directory, the card and the view counter. The rest
--    are predicate helpers that row-level security itself calls, and Postgres
--    requires the *calling* role to hold EXECUTE: a policy invoking a function
--    anon cannot execute does not fall through to the next policy, it errors,
--    and the page stops loading. Migration 43 learned that by breaking
--    /agents. Every one of them answers about the caller and returns false or
--    null to a stranger — probed, not assumed — and the suite now pins the
--    set, so a new one cannot join it quietly.
-- =============================================================================

create or replace function public.profile_completeness(p_agent_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  /*
    The gate is the outer CASE, not a WHERE inside the sum.

    Written as a WHERE first, which was wrong in a way worth recording: an
    aggregate over zero rows still produces one row, so `coalesce(sum, 0)`
    turned a refusal into a confident 0 — indistinguishable from a profile
    nobody has filled in. Null is the only honest answer to a question this
    will not answer.
  */
  select case
    when not exists (
      select 1 from agent_profiles a
       where a.id = p_agent_id
         and (a.user_id = (select auth.uid()) or public.is_admin())
    )
    then null
    else (
      select least(100, coalesce(sum(points), 0))::int
      from (
        select case when a.headline_ar is not null and btrim(a.headline_ar) <> '' then 15 else 0 end as points
          from agent_profiles a where a.id = p_agent_id
        union all
        select case when a.summary_ar is not null and btrim(a.summary_ar) <> '' then 20 else 0 end
          from agent_profiles a where a.id = p_agent_id
        union all
        select case when a.years_experience > 0 then 10 else 0 end
          from agent_profiles a where a.id = p_agent_id
        union all
        select case when array_length(a.tracks, 1) > 0 then 10 else 0 end
          from agent_profiles a where a.id = p_agent_id
        union all
        select case when array_length(a.district_ids, 1) > 0 then 10 else 0 end
          from agent_profiles a where a.id = p_agent_id
        union all
        select case when a.units_closed is not null or a.volume_egp is not null then 10 else 0 end
          from agent_profiles a where a.id = p_agent_id
        union all
        select case when exists (select 1 from agent_experience e where e.agent_id = p_agent_id) then 15 else 0 end
        union all
        select case when exists (select 1 from agent_education d where d.agent_id = p_agent_id) then 10 else 0 end
      ) parts
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- Saying out loud what an empty policy list means
-- ---------------------------------------------------------------------------

comment on table public.email_log is
  'The outbox. RLS is enabled with no policies deliberately: that is how this '
  'schema spells "service role only". Every read the product needs goes '
  'through email_activity() or email_activity_summary(), which are SECURITY '
  'DEFINER and gate on is_admin(). The database linter reports the empty '
  'policy list as a gap — it is the control, not the absence of one. Do not '
  '"fix" it by adding a policy.';

comment on table public.email_suppressions is
  'Addresses that hard-bounced or complained. RLS enabled with no policies, '
  'for the reason on email_log: service role only, and nothing in the product '
  'reads it except the send path. See the comment there before adding a policy.';

comment on function public.profile_completeness(uuid) is
  'The profile score, for its owner or an admin. Anyone else gets null — see '
  'migration 56.';
