-- =============================================================================
-- 64 — A live listing with no end date, which nothing could show
--
-- `stamp_job_publication` sets expires_at on every entry into `active`, so an
-- active row with a null expiry does not exist. Nothing says so, and three
-- places have had to write code as though it might:
--
--   The board and the company page filter `.gt('expires_at', now)`, which
--   drops a null outright — NULL > x is NULL in SQL — so a listing in that
--   state would be invisible on the board while still reachable by URL.
--
--   The sitemap, which noticed, spells the case out:
--   `.or('expires_at.is.null,expires_at.gt.…')`. So the two disagreed about
--   the same listing: advertised to Google, absent from the board.
--
--   jobIsLive() treats a null expiry as live, which is the third answer.
--
-- Three readings of a state that cannot occur is worse than any one of them
-- being wrong, because the disagreement is invisible until the state happens.
-- The constraint makes the trigger's behaviour a fact about the table, so
-- `.gt()` is simply correct and the sitemap's `.or()` becomes belt-and-braces
-- rather than the only place that got it right.
--
-- Checked against production first: 0 rows active with a null expiry, 3 with a
-- null expiry at all — all drafts, which is exactly the state the constraint
-- leaves alone. Nothing to migrate, which is the best time to add one.
--
-- Safe on every path, because `jobs_30_stamp_publication` fires BEFORE INSERT
-- as well as BEFORE UPDATE and a check runs after the BEFORE triggers. So
-- nothing that goes through the table is refused by this today — including a
-- seed or a restore that states `active` with no date, which is given one on
-- the way in.
--
-- Which is the point, and worth being plain about: this constraint changes no
-- behaviour. It is the thing that still holds if the behaviour changes. The
-- trigger has been rewritten three times in this schema — migrations 03, 46
-- and 49 — and `create or replace` has silently dropped a clause from it once
-- already. A duplicated rule in the table is how the third rewrite fails
-- loudly instead of quietly.
-- =============================================================================

alter table jobs drop constraint if exists jobs_active_has_expiry;

alter table jobs
  add constraint jobs_active_has_expiry
  check (status <> 'active' or expires_at is not null);
