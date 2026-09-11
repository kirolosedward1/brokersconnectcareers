-- =============================================================================
-- 61 — What a role like this actually pays, or nothing at all
--
-- Both sides of this market price blind. An employer writing their first
-- listing has no idea whether 9,000 basic for a primary consultant in Cairo is
-- generous or insulting, and a consultant reading that listing has nothing to
-- compare it to either. The inputs have been structured on every listing since
-- migration 01 — basic_salary_min, basic_salary_max, track, district — so this
-- is a query, not a model, and it is the strongest thing a job board knows
-- that a WhatsApp group does not.
--
-- ---------------------------------------------------------------------------
-- The threshold is the feature
-- ---------------------------------------------------------------------------
-- A "typical range" computed from two adverts is not a weak insight, it is a
-- made-up one, and it would be made up in the direction of whoever posted
-- those two. Five live listings in the bucket, or the function returns no row
-- at all — not a wide range, not a caveat, nothing for the page to render.
--
-- Zero rows rather than a row with a count in it, deliberately. "Only 3
-- listings so far" is itself a fact about how thin this board is, offered to
-- every visitor on every listing, and it invites the reader to do the
-- averaging in their head from the three they can see.
--
-- The board today has exactly one bucket that clears it — primary in Cairo,
-- five listings, all with a basic — so this is visible in one place and
-- silent in six. That is the shape it should have at this size.
--
-- ---------------------------------------------------------------------------
-- What the two numbers mean, precisely
-- ---------------------------------------------------------------------------
-- Every listing advertises a band, so a single median over "salary" would have
-- to invent a per-listing figure to take the median of. Instead: the median of
-- the advertised floors, and the median of the advertised ceilings. That reads
-- back as a sentence somebody can check — half of these listings start at or
-- below this, and half top out at or below that — rather than as a statistic
-- whose derivation only this file knows.
--
-- Listings with no basic at all are excluded rather than counted as zero.
-- Commission-only is a real and common arrangement here, and folding it in as
-- a zero would drag the floor down to describe something that is not a salary.
-- It also means the sample size is the number of listings the range is
-- actually made of, which is the number worth printing beside it.
--
-- SECURITY INVOKER, unusually for this schema, and that is the point: the
-- filter is `active` and unexpired, which is exactly the set row-level
-- security already shows everyone. There is nothing here a definer function
-- would unlock, so there is no reason to add one more of those to the list of
-- things somebody has to audit. An employer's own drafts are excluded by the
-- status filter, not by privilege — otherwise they would be comparing their
-- offer against their own unpublished numbers.
-- =============================================================================

create or replace function public.salary_reference(
  p_track          job_track,
  p_governorate_id int
)
returns table (
  sample int,
  low    int,
  high   int
)
language sql
stable
set search_path = public, pg_temp
as $$
  with sampled as (
    select
      j.basic_salary_min as floor_egp,
      -- A listing that advertises one figure rather than a band has the same
      -- floor and ceiling. Dropping it would shrink the sample to punish a
      -- listing for being precise.
      coalesce(j.basic_salary_max, j.basic_salary_min) as ceiling_egp
    from jobs j
    join districts d on d.id = j.district_id
    where j.status = 'active'
      and (j.expires_at is null or j.expires_at > now())
      and j.track = p_track
      and d.governorate_id = p_governorate_id
      and j.basic_salary_min is not null
  )
  select
    count(*)::int,
    percentile_cont(0.5) within group (order by floor_egp)::int,
    percentile_cont(0.5) within group (order by ceiling_egp)::int
  from sampled
  -- No group by, so this is the whole answer: below five, zero rows.
  having count(*) >= 5;
$$;
