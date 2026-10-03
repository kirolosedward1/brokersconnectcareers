-- =============================================================================
-- 337 — Emails a person asked for
--
-- 1. The profile reminder ("finish your profile", once, a few days after a
--    candidate signs up and stops) rode on notify_digest, a switch that is on
--    by default and labelled "weekly job roundup". It is the one email here
--    that answers nothing the person asked for — the code that sends it calls
--    it the closest thing to marketing — so it gets a switch of its own, off
--    unless the person turns it on:
--
--      profiles.notify_profile_nudge   default false
--
--    Unsubscribing from it (the email's own link) turns this off, and nothing
--    else.
--
-- 2. email_log kept every recipient address forever: its period was left
--    "decision required" (migration 204). It is delivery metadata — template,
--    address, status, the provider's reason for a failure — for working out
--    why somebody did not get an email, which nobody asks about half a year
--    later. Kept 180 days now, then pruned by the hourly maintenance that
--    already does it for notifications; an admin changes the period with one
--    statement (docs/data-lifecycle.md).
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: alter table profiles drop column notify_profile_nudge; update retention_policies set days = null, basis = 'decision_required' where key = 'email_log';
-- safety: ships-with-code — the column is new with a default and the code reads it tolerating its absence (no column: the reminder is off, the settings show no switch, a save that names it is refused and the switch puts itself back); the email_log period only starts the existing prune, which skips queued rows and keeps 7 days at the least

alter table profiles
  add column if not exists notify_profile_nudge boolean not null default false;

comment on column profiles.notify_profile_nudge is
  'Email the one-time "finish your profile" reminder. Off unless the person turns it on (migration 337).';

update retention_policies
   set days = 180,
       basis = 'product_default',
       note = 'Outbox metadata (template, recipient, status, the provider''s reason for a failure). No body is stored. 180 days: long enough to answer "why did I not get it", not a record of everybody ever written to (migration 337).'
 where key = 'email_log';
