-- =============================================================================
-- 130 — A bell for a decision about you
--
-- The console can suspend a company, restrict a consultant's profile, put an
-- account on hold and close somebody's report — and the person each decision
-- is about heard nothing. A suspended company found out by having the listing
-- form refuse it; a consultant found their profile missing from the
-- directory; the candidate who reported a fake advert never learned whether
-- anybody read it.
--
-- These are the kinds the moderation migrations write (131–133). They are
-- added on their own because Postgres cannot use an enum value in the same
-- transaction that created it — the pattern migrations 20 and 21 set.
--
-- Numbered 130+: parallel branches hold 068–072 (the console and the data
-- lifecycle, already applied to production), 073 (taxonomy, stacked on this
-- branch), 100–110 (security hardening), 120 (observability) and 200+
-- (support). Moderation takes 130–139.
-- =============================================================================

alter type notification_kind add value if not exists 'report_reviewed';     -- reporter: we looked at it
alter type notification_kind add value if not exists 'company_suspended';   -- company members
alter type notification_kind add value if not exists 'company_restored';    -- company members
alter type notification_kind add value if not exists 'profile_restricted';  -- consultant
alter type notification_kind add value if not exists 'profile_restored';    -- consultant
alter type notification_kind add value if not exists 'account_held';        -- the account holder
alter type notification_kind add value if not exists 'appeal_decided';      -- whoever appealed
