# Database security and data integrity audit — October 2026

_Branch `claude/database-security-integrity-jua0xq`. Audit run 2026-10-15/16, re-verified against production 2026-10-22. Builds on `SECURITY_REPORT.md` (migrations 303–313); this round's fixes are migrations **352** and **353**._

## Verdict

The schema is in good shape: every table has row-level security, every function pins its `search_path`, every privileged (definer) function checks its caller, and the ownership rules hold under a stranger-access sweep. Two problems did need fixing:

1. **Production is not what its migrations say.** Two functions were switched to `SECURITY INVOKER` by hand. One of them stops employers reporting fake or abusive consultant cards they find in the directory. Migration 353 puts them back.
2. **Deleting a company silently deleted its paid orders.** `orders.company_id` cascaded. Migration 352 makes it restrict, as `data-lifecycle.md` already said it did.

Production also does not yet have migrations **346–349**, and those carry live security fixes (below). **Nothing in this round was applied to production.** The release steps are at the end.

## How it was checked

- **Final schema, as Postgres sees it.** All 126 migrations were applied to an in-process Postgres (the test harness), then policies, grants, definer functions, foreign keys, constraints and triggers were dumped from the catalogs and reviewed. This covered 54 tables, 120 policies (13 of them on storage) and 245 functions, 192 of which are definer.
- **Access matrix.** For every table, as anon, two unrelated candidates, three employers (verified, unverified, pending) and with production's default grants: rows visible, rows updatable, rows deletable. Every non-zero cell was traced to the policy that grants it.
- **Definer functions.** Each one callable over the API was read for its caller check (`admin_begin()`, `is_admin()`, `acting_as_admin()`, `auth.uid()`, `my_company_id()`).
- **Production, read-only.** Supabase security advisor; catalog queries (bucket settings, storage policies, role timeouts, grants, one count of orders); the migration ledger; and a full schema fingerprint (`scripts/dr/fingerprint.sql`, 1,485 objects). No production rows were read or changed.
- **Rehearsal against production.** `scripts/release/rehearse.mjs` was run with production's ledger and fingerprint. It rebuilds production in an in-memory copy, proves the copy is identical to production, applies every pending migration, and checks the result against a fresh build of this branch.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High (production)** | `agent_card_listed_to_viewer()` and `admin_summary()` were changed to `SECURITY INVOKER` on production outside any migration, and anon's execute on the first was revoked. The first is called inside the `reports_insert_signed_in` policy. As invoker, it reads `profiles` under the reporter's own row policies, so a verified employer can report a directory consultant only if that consultant applied to them. Reproduced. | **353** restores both. Test reproduces the drifted state and the upgrade. |
| 2 | **High (production)** | Production lacks 346–349. Until they run: a candidate can overwrite a CV's bytes after the server checked them, or delete a CV an application points at. Photos and logos can be written straight into the public buckets, bypassing the re-encode that strips GPS data. A company can replace a reviewed verification paper. A suspended company still reads its applicants' names, numbers and CVs. Reviews can act on a version the admin never saw. | Rehearsed: all apply cleanly. **Operator action** below. |
| 3 | **Medium** | `orders.company_id ON DELETE CASCADE`. One delete of a company (admin policy, dashboard, `remove-demo.sql`) erased its payment records, which are needed for refunds, chargebacks and tax. | **352**: restrict. `remove-demo.sql` deletes demo orders explicitly. Production holds no order today. |
| 4 | Medium (config) | Leaked-password protection is **off** on production, although `SUPABASE_SETTINGS.md` lists it as on. | Dashboard toggle (operator). Doc now says so. |
| 5 | Low | `main` was red on two suites. `schema.test.mjs` still expected anon to call `my_company_id` (closed by 350), and `notifications.test.mjs` still expected a withdrawn application's receipt to survive (deleted by 351). | Tests updated to the behaviour those migrations chose. |

### Looked at and kept as they are

- **The advisor's 16 anon and 77 authenticated "definer function executable" warnings.** All are expected. The anon ones are predicates that row policies call (EXECUTE is checked as the caller), plus the two support-form functions. The authenticated ones all check their caller first. Main's 350 reached the same conclusion; `schema.test.mjs` pins the anon set.
- **Eight tables with RLS on and no policy** (`email_log`, `push_outbox`, `rate_limit_hits`, …). Deny-all is intended: only the service role touches them.
- **Moderation reasons.** Company suspension reasons and listing rejection notes are already constrained to null on the public tables and live in member-only tables (327, 347). A consultant's `restriction_reason` is readable only by the consultant and admins in practice, because restricting also hides the card and the owner cannot unhide it.
- **`job_search_documents` readable by everyone.** It only ever holds documents for public listings (active, expired, closed); the refresh deletes the rest.
- **Pending employers read their company's applicants.** This is by design (308): a pending account has to finish onboarding. Exposure needs a company admin to add the account first. Worth revisiting if colleagues ever join without review.
- **`companies_select_public` shows `owner_id` and `post_credits`.** Already recorded in `SECURITY_REPORT.md` §12.

## Integrity

- **Ownership:** every user-writable row is pinned to `auth.uid()` or a company membership in `WITH CHECK`, and the guard triggers stop ownership columns being re-pointed on update (`guard_application_update`, `guard_company_membership`, `guard_notification_update`, `guard_agent_restriction`, …).
- **Constraints:** non-negative credits and amounts, ranges, path shapes, URL schemes, state/timestamp agreement and private-column checks are all validated. The unique keys cover one application per listing, one company per owner, idempotency keys and the email dedupe key.
- **Deletes:** auditing every foreign key's `ON DELETE` rule found one wrong cascade (finding 3). The recruitment-history restricts from 203 stand. Personal data cascades with its person, as the privacy policy says.
- **Transactions:** `settle_order` locks the row and binds the signed Paymob fields (312). Rate limits and caps take advisory locks. The concurrency suites run on a real two-connection Postgres.
- **Migrations:** `pnpm db:lint` blocks unacknowledged destructive, RLS, grant and constraint changes. `pnpm test:release` rebuilds production's order. The rehearsal can now also model changes made outside any migration (`OUT_OF_BAND` in `scripts/release/migrations.mjs`), so a hand edit is recorded in the repository rather than rediscovered.

## Tests

`pnpm test:release && pnpm test:db && pnpm test:remove-demo && pnpm typecheck && pnpm db:lint`: **2,109 checks, 0 failures**. New checks are in `security.test.mjs` §352–353, and each fails without its migration.

## Releasing this to production — operator steps

Production changes are not applied from this branch. They follow the release runbook (`docs/release/2026-09-prod-reconciliation.md`, `docs/security/RUNBOOKS.md` §C):

1. **Backup first:** take a manual backup / PITR marker (`pnpm dr:backup`, or Dashboard → Database → Backups).
2. **Rehearse against today's production.** Run `pnpm db:rehearse:ledger --ledger <list_migrations.json> --fingerprint <fingerprint.json>`, with the fingerprint from `scripts/dr/fingerprint.sql`. The expected result is "rehearsal passed", with 346, 347, 348, 349, 352 and 353 pending. This passed on 2026-10-22.
3. **Optional staging step:** apply to a Supabase branch or the `brokersconnect-dr-drill` project first, and run `pnpm smoke` against a preview pointed at it.
4. **Deploy the website from `main`, then run `pnpm db:apply --execute`** against production. Never use `db:push:url`, which re-runs everything. Each file runs in its own transaction with its ledger row.
5. **Verify:** re-run the fingerprint and the rehearsal (no pending files, fingerprint identical to a fresh build), then `get_advisors`. Once 353 has run, the `OUT_OF_BAND` entry stops applying by itself.
6. **Dashboard:** turn on leaked-password protection (Authentication → Attack Protection).
7. **Answer the advisor without the dashboard.** Changes made in the dashboard are what caused finding 1. If an advisor warning needs answering, answer it with a migration, so the next fingerprint stays clean.
