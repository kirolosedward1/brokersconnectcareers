-- =============================================================================
-- 59 — A company slug is a promise, so stop letting it be edited
--
-- `companies.slug` is written once, by withUniqueSlug on insert, and the edit
-- form has never included it. So today the column is already immutable — by
-- habit, not by rule, which is the kind of invariant that holds until somebody
-- adds a field to a payload.
--
-- Three things now depend on it and none of them can tell you when it breaks:
--
--   /companies/<slug> is the public address of the company, and the one that
--   ends up in Google and in WhatsApp forwards.
--
--   /jobs?company=<slug> narrows the board to one brokerage.
--
--   A follow is a saved search whose query is exactly `company=<slug>`. Change
--   the slug and the row keeps matching nothing: the board shows an empty
--   result and the weekly digest quietly finds no new roles, forever, with no
--   error anywhere and nothing on the candidate's screen to explain it.
--
-- The third is why this is a migration and not a comment. The first two break
-- loudly enough to be noticed — a 404 gets reported. A follow that stops
-- arriving is indistinguishable from a brokerage that stopped hiring.
--
-- A rename is not thereby forbidden; it is just not a slug change. A company
-- renaming itself keeps its address, exactly as it does everywhere else on the
-- web, and the day this platform grows a redirect table is the day to relax
-- this deliberately rather than discover it was never enforced.
--
-- Admins still pass: the early `acting_as_admin()` return is how a genuinely
-- broken slug gets fixed, and an admin doing it knows what it costs.
--
-- The whole body is restated because `create or replace` replaces the whole
-- function. Dropping migration 44's submission clause, 41's credit marker, or
-- the `set search_path` from 07 by writing only the new check is a mistake
-- this schema has made three times; the policy suite catches it within a
-- minute, which is not the same as it not happening.
-- =============================================================================

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
    -- Submitting papers is a transition the company makes, and the only one.
    -- Anything other than unverified/rejected -> pending is still a refusal,
    -- so this cannot become a way to arrive at `verified`.
    if not (
      coalesce(current_setting('app.submitting_for_review', true), 'off') = 'on'
      and new.verification_status = 'pending'
      and old.verification_status in ('unverified', 'rejected')
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
