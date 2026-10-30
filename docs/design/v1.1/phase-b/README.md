# v1.1 Phase B: proposals waiting for approval

The v1.1 brief says Phase B items must not be faked in the UI. Each one gets
a design doc here first, with the migration and the server actions it needs.
After approval it gets built, one PR per doc. **Nothing in this folder is
built yet.**

Each doc follows the same shape: the boards it serves, what the platform
already has, the proposed schema (migration sketch with rollback and safety
lines, as `supabase/migrations` writes them), row-level security, the website
actions the app would call through `/api/mobile/v1/actions/<name>`, the app
screens, the analytics events, and the **decisions needed** before work
starts.

Migration numbers are placeholders. The real number is the next free one
when a doc is approved. The last one taken in this branch is 370
(`company_response_stats`).

| # | Doc | Boards | Needs a product decision? |
|---|-----|--------|---------------------------|
| 01 | [Bulk actions in the pipeline](01-pipeline-bulk.md) | PipelineBulk | Decline reasons list |
| 02 | [Shared candidate notes and «تقدّم من قبل»](02-shared-notes-and-history.md) | CandidateHistory, ApplicantReview | Note visibility across listings |
| 03 | [Team roles, scopes and caps](03-team-roles.md) | TeamRoles, TeamInvite, MemberDetail | Role list; reveal caps vs today's limits |
| 04 | [Team activity log and export](04-team-activity.md) | TeamActivity | Retention period |
| 05 | [Approvals and limits](05-approvals-and-limits.md) | ApprovalsLimits | Which actions need approval |
| 06 | [Shared saved replies](06-saved-replies.md) | SavedReplies | Variables, channels |
| 07 | [Company account](07-company-account.md) | CompanyAccount, CompanySettings | Grace periods, ownership transfer rules |
| 08 | [Packs, promotion, checkout, orders, subscriptions](08-purchases.md) | Plans, PromoteListing, Checkout, Orders, Subscription | **App Store rules; subscription tiers not approved** |
| 09 | [Interview invites](09-interview-invites.md) | EmployerHome (interviews today), ApplicationDetail | Calendar, reminders |
| 10 | [Gaps found while building Phase A](10-gaps-from-phase-a.md) | Alerts, NotificationPrefs, EmployerNotifPrefs, Privacy, Availability, Support, ListingStats, RevealConfirm, OnbCompany1–3, Appearance | Several, listed per gap |

## Rules every proposal keeps

- **Writes go through the website.** Every new write is a server action in
  `src/lib/actions`, registered in `src/lib/mobile-api/registry.ts` and typed
  in `contract.ts`, so emails, rate limits and audit rows happen once.
- **Row-level security first.** A new table is readable only by the people
  the doc names. Anything cross-company goes through a `security definer`
  function that returns aggregates or the caller's own rows. If it is
  anon-callable it goes on the allowlist in `supabase/tests/schema.test.mjs`.
- **Every migration has a PGlite test** in `supabase/tests/`, plus rollback
  and safety lines in its header.
- **No unbacked numbers.** A figure is drawn only when the database records
  it. These docs are where the boards' unbacked figures get their backing.
- **Arabic first.** New copy is MSA in `ar.json`, with the same keys in
  `en.json`.
