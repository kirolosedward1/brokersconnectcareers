# Data lifecycle

What happens to every kind of record on Brokers Connect when the thing it
describes changes or ends, what cleans up after it, and which periods are still
waiting on a decision.

Implemented in migrations **203** (`what_a_delete_is_allowed_to_take`) and
**204** (`housekeeping_that_runs_itself`), `/api/cron/lifecycle`, and
`deleteMyAccount()`. Tested in `supabase/tests/lifecycle.test.mjs` (PGlite) and
`supabase/tests/lifecycle-concurrency.test.mjs` (real Postgres, two
connections).

## Principles

- **Close, don't delete, anything two parties share.** A listing someone applied
  to is recruitment history for both sides. It expires, closes or is rejected;
  the database refuses to delete it (`applications.job_id … on delete restrict`).
- **A person's own data goes when they go.** Deleting a candidate removes their
  profile, directory card, CV sections, saved jobs and searches, notifications
  and applications, and queues every file they uploaded.
- **Facts about the platform's own conduct outlive the people involved.**
  Moderation and account decisions are written to `audit_events` (ids and
  states only, never names or text). The actor becomes `null` when their account
  is deleted; the record stays.
- **Soft state where the product already has one, hard delete where it doesn't.**
  Jobs have `closed`/`expired`/`rejected`; accounts have `approval_status`. No
  `deleted_at` column was added anywhere. A soft-delete flag on everything would
  mean every query has to remember it, and nothing here needs one.
- **No file is deleted at the moment it stops being referenced.** It is queued,
  waits out a grace period, and is re-checked against every column that can
  point at it before it is handed to a worker.
- **Periods are data.** `retention_policies` holds every period. `null` means
  "keep; this cleanup does not run".

## Lifecycle matrix

| Entity | Created | Updated / replaced | Ends (expired · closed · withdrawn · suspended) | Deleted | Kind |
|---|---|---|---|---|---|
| **Auth account** (`auth.users`) | Signup (email or Google) | GoTrue | Suspension is on the profile (`approval_status`) | `deleteMyAccount()` or dashboard. **Refused for a company owner** (FK restrict). Cascades to profile. | Hard |
| **Profile** (`profiles`) | `/onboarding`. No row = not onboarded. | Owner edits; role/approval are admin-only (guard) | `approval_status = rejected` suspends: cannot apply or post; the company's live listings are rejected if no other approved member remains | With the auth user. `email_log.recipient` redacted first; `account_deleted` written to `audit_events`; avatar queued. | Hard |
| **Candidate / agent profile** (`agent_profiles` + experience, education, certifications, developers) | Candidate saves profile | Owner edits; CV replacement queues the old file | Visibility `hidden` removes from directory and from saved pools (re-derived per read) | Cascades with profile; CV queued | Hard |
| **Employer profile** | Onboarding as employer (`pending` approval) | As profile | Suspension as above | Blocked while they own a company. A non-owner member may delete freely (membership cascades). | Hard |
| **Company** (`companies`) | Employer creates; owner auto-added as admin member | Admin members edit; slug immutable; logo replacement queues old file | Unverified ↔ pending ↔ verified/rejected; `verified_at` stamped by trigger | No product path. Owner's account deletion is refused while it exists. Deletion of a company with applied-to listings is refused by the FK. **Decision required** (see below). | — |
| **Company membership** (`company_members`) | Owner on create; invites | Role change (owner always admin) | — | Removal (not the owner); cascades on member's account deletion. Audited. | Hard |
| **Verification document** (`company_documents` + private file) | Admin member uploads (`pending`) | Review sets `verified`/`rejected`, `reviewed_at` stamped | — | Owner may withdraw while `pending` → file queued (1-day grace). Reviewed documents are kept while the company is verified, and deleted a year after it stopped being (`companies.verification_ended_at`) — or a year after their review if it never was; never while waiting for review (migration 338). | Hard |
| **Job** (`jobs`) | Draft → pending_review → (moderation) active | Material edit of a live listing → pending_review | **Expired** at `expires_at` (hourly pg_cron + nightly Vercel; reads use the date regardless). **Closed** by employer. **Rejected** by moderation or suspension. All keep their URL (noindex, "closed" state), stay visible to the employer and to applicants, and keep every application. | Only if nobody applied (FK restrict). No product path. | Soft (status) |
| **Application** (`applications`) | Candidate applies to a live listing (policy checks `expires_at > now()`) | Employer moves status; history in `application_events` | Job expired/closed/rejected: application kept, both sides still see it. Candidate withdraws only while `new`/`shortlisted`. | Withdrawal and candidate account deletion hard-delete the row, its events and notes; CV queued. Deleted the same way twelve months after it was sent, as the privacy policy says, without telling the company it was withdrawn (migration 338). **Decision required** on tombstones (below). | Hard |
| **Application history / notes** | Trigger / employer | Notes are append-only | — | With the application. Author/actor nulled on their account deletion. | Hard |
| **Saved job** | Candidate | — | Job ends: kept (candidate sees it as closed) | Candidate unsaves; cascades on either side | Hard |
| **Saved search / follow** | Candidate | Candidate | — | Candidate; cascades | Hard |
| **Saved consultant** (`saved_agents`) | Company member | — | Consultant hidden → row shows nothing identifying | Member removes; cascades | Hard |
| **CV file** (`cvs`, private) | Browser upload into own folder | Replacement queues the old path | — | Queued on row deletion/replacement; removed after 1 day **only if no application or profile references it**. Removed immediately on account deletion. | Hard |
| **Profile photo** (`avatars`, public) | Browser upload | Replacement queues old path | — | Removed after 7 days (cached pages, emails) if unreferenced | Hard |
| **Company logo** (`company-logos`, public) | Admin member upload | As above | — | As above | Hard |
| **Notification** (`notifications`) | Triggers only | User marks read | — | User deletes; read ones pruned after 180 days, unread after 365 | Hard |
| **Email outbox** (`email_log`) | `claim_email()` | Sweeper / webhook | — | Recipient redacted on account deletion; rows pruned after 180 days (migration 337). | Hard |
| **Email suppression** | Bounce/complaint webhook | — | — | Kept (about the address, not the account). **Decision required.** | Retained |
| **Report** (`reports`) | Signed-in user | Admin resolves (`resolved_at` stamped) | — | Reporter nulled on their deletion; resolver nulled on theirs | Retained |
| **Audit event** (`audit_events`) | Triggers on approval, role, verification, membership, job status, document review, account/company deletion | Never | — | Never pruned (**decision required** on a period) | Retained |
| **Profile views** (`agent_profile_views`) | Employer views consultant | — | — | 60 days (already stated in the privacy policy) | Hard |
| **Order / free-post grant** | Billing | `settle_order()` | — | Refused while the company exists | Retained |
| **Sessions / tokens** | GoTrue | GoTrue | — | Managed by Supabase Auth; deleted with the auth user. `unsubscribe_token` goes with the profile. | — |
| **Maintenance runs / storage queue** | The jobs themselves | — | — | 90 days / 30 days after completion | Hard |

## Retention decisions

| Key | Period | Basis |
|---|---|---|
| `notifications_read` | 180 days | Product default; decisions they announced are in `audit_events` |
| `notifications_unread` | 365 days | Product default |
| `agent_profile_views` | 60 days | Already published (migration 63, privacy policy) |
| `storage_grace_public` | 7 days | Operational: cached pages and sent emails hold the URL |
| `storage_grace_private` | 1 day | Operational: signed URLs last 5 minutes |
| `maintenance_runs` | 90 days | Operational |
| `storage_gc_done` | 30 days | Operational |
| `email_log` | 180 days | Product default (migration 337): long enough to answer "why did I not get it" |
| `applications` | 365 days | Already published: "twelve months from the date of application" (migration 338) |
| `company_documents` | 365 days | Already published: "while verified, and a year after" (migration 338) |
| `security_events` | 365 days | Product default (migration 338) |
| `agent_contact_reveals` | 90 days | Product default (migration 338): the daily limits read a day |
| `rate_limit_hits` | 2 days | Operational (migration 338): the longest window is a day |
| `abandoned_signups` | **none (report only)** | Decision required |

Change a period with one statement as an admin, for example
`update retention_policies set days = 365 where key = 'email_log';`.

## Scheduled jobs

| Job | Where | When | What |
|---|---|---|---|
| `run_lifecycle_maintenance()` | pg_cron `brokersconnect-lifecycle-maintenance` | `7 * * * *` | Expire listings (500/run), prune notifications/views/email_log (5,000/run), queue orphan files (500/run), prune its own logs |
| `/api/cron/lifecycle` | Vercel | `23 2 * * *` | Calls the same function (a concurrent call records `skipped`), then deletes claimed files through the Storage API (≤5 × 100), then abandoned signups if a period is set |
| `/api/cron/expire-jobs` | Vercel | `0 1 * * *` | Unchanged: expiry plus the expiring/expired emails |
| `run_privacy_retention()` | pg_cron `brokersconnect-privacy-retention`, and `/api/cron/lifecycle` | `37 3 * * *` / nightly | The periods above for applications, verification papers, security events, contact reveals and rate-limit counters; bounded, skip-locked, one run at a time (migration 338) |

Every job:
- **Bounded.** Each batch has a limit and walks an index.
- **Idempotent.** A second run immediately after does nothing; the tests assert this.
- **Retry-safe.** A run is one transaction, so a crash rolls back. Storage claims hold a 10-minute lease, a failed removal is released with its error, and a file stops being retried after 5 attempts and shows up in the report.
- **Safe with two workers at once.** `pg_try_advisory_xact_lock` on the whole run, and `for update skip locked` on every batch. Proven against real Postgres with two connections.
- **Observable.** One `maintenance_runs` row per run, including a run that skipped, with counts and per-step errors.

## Orphan detection and repair

`select * from lifecycle_integrity_report();` (admin or service role), or run
`pnpm lifecycle:audit` over `DATABASE_URL`. It is read-only and checks for:

- auth users with no profile, and accounts pending for over 30 days
- an owner who is not an admin member, a member who is not an employer, an agent profile or application belonging to a non-candidate
- applications with no history, active listings past their date, duplicate live listings
- notifications about missing jobs, email rows about missing applications, employer-owned saved searches
- CV, avatar, logo or document references to missing files; unreferenced files not yet queued; exhausted cleanup items
- maintenance that has not run in 26 hours

`repair_lifecycle_integrity(p_apply)` is a dry run by default. It only fixes what
needs no judgement about a person: restoring owner memberships, relabelling
expired listings, backfilling application history, and **queueing** (not
deleting) unreferenced files. Everything else is reported for a person to decide.

Profiles without auth accounts, applications without jobs, and duplicate
memberships or applications cannot occur: foreign keys and primary or unique keys
prevent them.

## Decisions required (legal / business)

These are not settled in code. Each one defaults to keeping data.

1. **Company closure.** What happens to a company, its listings and its received applications when the business leaves, or when its owner wants to delete their account? Today both are refused. Options: transfer ownership to another admin member, anonymise the company, or delete once there are no applications.
2. **Withdrawn and deleted-candidate applications.** Today they are hard-deleted, so the employer loses the record. Should a de-identified tombstone (job, status reached, dates, no person) be kept for the employer's history and reporting? And for how long?
3. ~~**`email_log` retention.**~~ Set to 180 days (migration 337); change it with one statement as above.
4. **`email_suppressions`.** Should a suppression be kept after the account is deleted? It is currently kept, to avoid mailing a dead address again.
5. **`audit_events` retention**, and whether actor ids are kept after the actor's account is deleted (currently nulled).
6. **Abandoned signups.** The period after which never-confirmed, never-signed-in, never-onboarded auth accounts are removed. Detection is built; deletion does not run until a period is set.
7. ~~**Reviewed verification documents.**~~ A year after the company stopped being verified, or after their review if it never was (migration 338).
8. **Employer access to applications after a candidate deletes their account.** Today it is cut immediately, because the row cascades.
9. **Notification periods** (180/365). These are product defaults and need sign-off.
10. **Reports, appeals and support requests.** Kept with no period; after the sender's account is deleted they stay, unlinked (`reporter_id`, `appellant_id`, `user_id` set null), and a support request from somebody signed out keeps their contact address. The privacy policy and `/account-deletion` say they are kept; a period (two years after closing, say) would let them say for how long.
11. **Names in `admin_audit_log`.** `target_label` holds the name a moderation decision was about, with no period, and survives the account's deletion. The deletion page says so. Decide a period, or blank the label when the account it names is deleted.
12. **Backups.** The production database still holds `backup_2026_09_29`, a full copy of the 34 public tables taken before the 29 September release (not reachable through the API). Every account deleted since is still in it. Drop it once nothing needs it (`drop schema backup_2026_09_29 cascade;`), and give any backup kept in future a period the privacy policy can state.
13. **Next release: the Google branch of the avatar guard.** Migration 339 cleared profile photos that are not files in our storage (Google's copies, imported at sign-up before this release stopped doing it). `guard_profile_avatar()` (migration 322) still accepts a `googleusercontent.com` URL, because the code running before this release writes one; once this release is live, restate the guard without that branch — and in the same migration run 339's `update` again. Somebody who signs up with Google between 339 being applied and this release's code going live is still given their Google photo, and a guard judges only new writes, so taking the branch out alone leaves that photo where it is.
