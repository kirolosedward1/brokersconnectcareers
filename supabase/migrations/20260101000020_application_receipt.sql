-- =============================================================================
-- 20 — The candidate applied into silence
--
-- notification_kind had `application_received`, which goes to the employer,
-- and `application_moved`, which reaches the candidate only once an employer
-- does something. There was nothing for "we have your application", so a
-- consultant submitted and heard nothing — possibly forever, since a listing
-- that gets no employer attention produces no candidate-facing event at all.
--
-- In a market whose default is a WhatsApp message answered in a minute,
-- silence after submitting is the reason somebody goes back to WhatsApp.
--
-- Written into the existing trigger rather than a second one on the same
-- event: two notifications, one insert, one place to read to find out what
-- applying does.
-- =============================================================================

alter type notification_kind add value if not exists 'application_submitted';
