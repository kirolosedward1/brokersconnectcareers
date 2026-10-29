# Website feature verification — 2026-10-29

Validated the website against an isolated local Supabase stack with its real PostgreSQL, Auth, REST and Storage services. No production data or external provider credentials were used.

## Results

| Check | Result |
|---|---|
| Production build against local Supabase | Passed |
| Full `pnpm check` | Passed; 4,575 reported assertions plus 18 route regression tests |
| PostgreSQL concurrency | 34 passed (included in the full-check count) |
| Optional native PostgreSQL lifecycle races | 8 passed in a PostgreSQL container; initially skipped on the host |
| `node scripts/doctor.mjs` | Passed: REST, taxonomies/search visibility, storage buckets, Auth |
| API user journeys | 64 passed |
| Edge journeys with local JWT secret | 147 passed, including expired-token rejection |
| Chromium website journeys | 95 passed; email-reset journey skipped without a mail sink |
| Chromium admin MFA journey | 15 passed |
| Mobile API smoke tests | 34 passed |

The full suite ran after the prior security changes. After the sign-in interaction change below, type checking, authentication tests, production build, full browser journeys and the MFA browser journey were rerun. Counts describe their respective runners, not unique features; they should not be summed into a coverage percentage.

## Behavior exercised

- Public pages, search with results and empty results, missing listings, directories, legal pages and authentication redirects.
- Signup, input validation, onboarding and consent, candidate account screens, sign-in/out, interrupted connections, and account deletion verified in PostgreSQL.
- Valid CV and photo uploads, wrong-owner storage paths, disguised executable/PDF and image files, recording a CV with an application, and removal of stored files on account deletion.
- Saved jobs and notes, company follows, saved searches, applications and duplicate submissions, employer access and private notes, status transitions, notifications, withdrawal and listing moderation.
- Employer/admin pages, company form persistence, admin MFA enrollment, invalid codes, verified access and subsequent challenges.
- Actual migrations from an empty local database, RLS, tenant isolation, database concurrency and lifecycle cleanup races.

## Fixes made during verification

1. `scripts/doctor.mjs` incorrectly classified any URL containing `127.0.0.1` as a placeholder. It now tests a local backend through the same real REST/schema/storage/Auth checks. It also rejects `REPLACE_ME` placeholders and no longer prints credential prefixes.
2. A browser run stalled when the email sign-in panel closed and blocked submission. Isolated runs did not reproduce the timing failure, but repeated clicks on “Sign in with email” toggled an already open panel closed. That button now opens/focuses the panel consistently. Added regression checks for repeated clicks, preserved input and submit-button reachability. The full browser run subsequently completed, including account deletion.

## Environment repairs

Google Fonts access now works. To fit the official Supabase PostgreSQL image into the environment's Docker vfs storage, its verified filesystem was imported as one layer with its original startup configuration. Other images came from Supabase's official GitHub registry mirror after failures from the default registry.

Local container names were added to proxy exclusions. BusyBox wget nevertheless sent localhost health probes through the proxy; a local container helper bypasses the proxy only for the exact Auth and Storage loopback health URLs. Both real probes passed, and the services report healthy. Reusable startup instructions were saved to the environment draft.

## Limits

This establishes behavior in the tested local environment, not that every possible input or the deployed production database is faultless. Real Google/Apple OAuth, Resend delivery, emailed password resets, Paymob transactions, production backups and deployed configuration were not verified. The local Google provider configuration uses CI placeholders; seeing it enabled does not establish that Google sign-in works.

The website's health endpoint returns HTTP 200 with `degraded` status: database access works, while operational email/scheduler configuration remains incomplete. Unit tests exercise email/payment logic, but do not establish external delivery or payment processing. Before release, run provider-dependent journeys on staging with appropriate credentials and verify production health, migrations and backups separately.
