-- =============================================================================
-- 363 — The candidate delete goes, once the new server is live
--
-- 362 kept applications_withdraw_candidate and the AFTER DELETE withdrawal
-- notice so the server already in production can still delete a new or
-- shortlisted application and still tell the company. This file removes
-- both. Apply it only after #75 is serving: that server calls
-- withdraw_application and does not delete.
--
-- Order: apply 361, then 362, then merge and deploy #75, then this file.
--
-- applications_notify_withdrawal_on_update stays. A delete and an update are
-- different statements, so the two triggers never both fired for one
-- withdrawal. Retention purges set app.retention_purge, and 362's function
-- returns before notifying while this delete trigger still exists. Once the
-- trigger is gone, a purge has no withdrawal notice to send.
-- =============================================================================

-- rollback: forward-fix only — putting the delete back would let a candidate erase a row the new server keeps; to undo, recreate applications_withdraw_candidate from migration 42 and applications_notify_withdrawal from migration 52
-- safety: ships-with-code — apply this only after #75 is live. That server calls withdraw_application and does not delete, so dropping the policy and the delete trigger removes a path the live code no longer uses. Applied earlier, the old server's delete matches no row, the withdrawal is refused, and the row stays until the new server is deployed
-- safety: rls — applications_withdraw_candidate is the candidate delete from migration 42. After #75 the candidate withdraws only through withdraw_application. Dropping the policy refuses a delete of a new or shortlisted row; employers never had this policy
-- safety: drop — applications_notify_withdrawal is the AFTER DELETE notice from migration 52. The AFTER UPDATE trigger applications_notify_withdrawal_on_update remains, and that is what a withdrawal notifies through. A retention purge does not notify: while this trigger existed, 362's function returned early when app.retention_purge was on, and after this drop there is no delete trigger left to fire

drop policy if exists applications_withdraw_candidate on applications;

drop trigger if exists applications_notify_withdrawal on applications;
