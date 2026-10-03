-- =============================================================================
-- 340 — Indexes the advisor asked for
--
-- Supabase's performance advisor (2026-10-02) found three foreign keys with no
-- index behind them. Each is followed on a delete elsewhere, so without one
-- Postgres reads the whole table to find the rows to cascade or clear:
--
--   push_tickets.device_id     (on delete cascade)  — a phone signing out,
--                                                     an account deleted
--   push_tickets.outbox_id     (on delete set null) — the outbox pruned
--   support_requests.replied_by (on delete set null) — an admin's account
--                                                     deleted
--
-- The tables are small today (tickets live two days), which is why nobody
-- noticed; they are the kind that are not small on a bad day. The schema test
-- (supabase/tests/schema.test.mjs) now fails on any foreign key without one.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: drop index if exists push_tickets_device_idx; drop index if exists push_tickets_outbox_idx; drop index if exists support_requests_replied_by_idx;
-- safety: ships-with-code — indexes only: no code reads or writes them, so either order is the same; each table is small enough that the build's brief write lock is not felt

create index if not exists push_tickets_device_idx on push_tickets (device_id);
create index if not exists push_tickets_outbox_idx on push_tickets (outbox_id) where outbox_id is not null;
create index if not exists support_requests_replied_by_idx on support_requests (replied_by) where replied_by is not null;
