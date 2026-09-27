-- =============================================================================
-- 200 — A reply the bell can carry
--
-- Support answers people inside the product (migration 201), and the bell is
-- how somebody learns an answer is waiting. That needs a notification kind.
--
-- Its own file, and first, for the reason migration 20 gave: Postgres will not
-- let a transaction use an enum value the same transaction added, and
-- db-push.mjs wraps each migration in a transaction of its own.
--
-- Numbered 200 rather than 68. Eight branches opened on the same afternoon each
-- claimed 68 to 70, and one took 100 to 110; a number nobody else is near is
-- the cheapest way to not be the ninth collision.
-- =============================================================================

-- rollback: forward-fix only — Postgres cannot drop a value from an enum, and
--   an unused one is inert: nothing writes it until migration 201's answer
--   function is called, and no code on any branch reads it yet.
-- safety: ships-with-code — src/lib/support/ is imported by nothing yet and
--   never names this value, so either may reach production first.

alter type notification_kind add value if not exists 'support_replied';
