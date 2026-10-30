-- =============================================================================
-- 372 — Two kinds of interview notice
--
-- The notification kinds migration 373 writes: an invitation, to the
-- candidate, and the candidate's answer, to the company's members. In a file
-- of their own because Postgres will not use an enum value in the
-- transaction that adds it.
--
-- rollback: none needed — Postgres cannot drop an enum value; unused, it is inert
-- safety: additive — a build that does not know the kinds shows the bell's generic line
-- safety: ships-with-code — enum values only; no running code writes them until the interview
--   actions land, and a bell that does not know them draws its generic line.
-- =============================================================================

alter type notification_kind add value if not exists 'interview_invited';   -- the candidate
alter type notification_kind add value if not exists 'interview_answered';  -- the company's members
