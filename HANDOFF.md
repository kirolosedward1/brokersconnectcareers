# Handoff — Brokers Connect Careers

State as of 2026-10-22 (main at `bc2408d`; branch `claude/tender-davinci-dzouqf` carries the admin work below). No secrets in this file; none belong in the repo.

## What it is

Arabic-first job board for Egypt's real-estate brokerage market (candidates = sales consultants, employers = brokerages).

- **Web** (repo root): Next.js 15 + TypeScript + Supabase, pnpm, Node 22 (`.nvmrc`). Deployed by **Vercel** on every push to `main`.
- **iOS app** (`mobile/`): Expo SDK 57 / React Native, expo-router, TanStack Query, Supabase JS. Talks to Supabase directly (RLS) and to the website's `/api/mobile/v1/*` for server actions.
- **Database**: Supabase project ref `hiwdhicwsohbipxzazmb`. Schema lives in `supabase/migrations/` (numbered `20260101000NNN_*.sql`; latest `…352`).

## Layout

| Path | What |
|---|---|
| `src/` | Next.js app. `src/lib/**` is **shared with mobile** (imported as `@/lib/...`; checked by `mobile/scripts/check-shared.mjs`) |
| `messages/{ar,en}.json` | Shared translation catalogue (web + app); `mobile/src/i18n/messages/` holds app-only keys |
| `mobile/src/app/` | expo-router routes (tabs are grouped route folders, e.g. `(tabs)/(home,jobs,…)/jobs/[slug]/apply.tsx`) |
| `mobile/src/{components,features,lib}` | UI, data hooks, infrastructure (supabase client, api, session, direction, timeouts) |
| `mobile/tests/` | Jest + RNTL; `tests/server.ts` fakes Supabase/API over fetch |
| `supabase/migrations`, `supabase/tests` | SQL + DB tests |
| `docs/` | `mobile.md`, `app-store.md` (store/TestFlight steps), security, release, DR |
| `.github/workflows/` | `web.yml`, `mobile.yml`, `expo-go.yml` (OTA), `e2e.yml`, `ios-screens.yml`, `dr-backup.yml` |

## Running checks

```bash
# Node 22, pnpm via corepack
pnpm install && (cd mobile && pnpm install)

cd mobile && pnpm check   # typecheck (app + tests), eslint, check:shared, check:updates, check:licenses, jest (~1100 tests, ~1 min)
cd .. && pnpm typecheck   # web; `pnpm check` at root runs the full web/DB suite (DB tests need a local Supabase)
```

- `mobile/.env` is required for `expo start` — copy `mobile/.env.example` (public URL, publishable key, site URL; the same values are in `mobile/eas.json`). Without it `mobile/src/lib/env.ts` **throws at startup** ("Missing EXPO_PUBLIC_…") — the "crash on local setups".
- `next lint` at root stops at an interactive prompt (no ESLint config for the web) — use `pnpm typecheck`.
- Adding a mobile package changes `src/lib/licenses/app.json`: regenerate with `node scripts/licenses.mjs app` or `check:licenses` fails.

## Deploying

- **Push to `main`** = deploy. Vercel builds the web; `expo-go.yml` auto-publishes an Expo Go OTA when `mobile/**`, `src/lib/**` or `messages/**` change.
- **Manual OTA** (what was used this session, after each batch):
  ```bash
  cd mobile && CI=1 node scripts/publish-update.mjs expo-go --message "…" --non-interactive
  ```
  Needs `EXPO_TOKEN` in the environment (EAS account `kirolosedward1`, project id `5598b160-d5fd-42e3-9cfd-14097b6677e9`). Channel `expo-go`, runtime `exposdk:57.0.0`, iOS only. The script prints the update group id and the QR page (`https://qr.expo.dev/eas-update?slug=exp&projectId=…&channel=expo-go`).
- Store builds use channels `production` / `preview` (`eas.json`); runtime differs from Expo Go's.
- **Which update a phone runs**: Account (حسابي) footer shows `<update id 8 chars> · <commit>` (from `buildMarker()` in `mobile/src/features/update.ts`; commit baked in by `app.config.ts` `extra.commit`). Expo Go applies a new update on the *next* launch — tell the user to close and reopen (sometimes twice). This caused one false "still broken" report this session.
- **Migrations**: commit the SQL in `supabase/migrations/`, apply to production (this session used the Supabase MCP `apply_migration`; repo also has `pnpm db:apply`).

## Fixed this session (all on main)

| Commit | Fix |
|---|---|
| 4ffaf6c | Expo SDK 57 packages aligned with Expo Go (`expo install --fix`) |
| 13f4cc4 | Sign-out always finishes (bounded `signOut`, local sign-out signal `lib/local-sign-out.ts`) |
| 89d51f8 | CV read falls back to legacy base64 when `File.arrayBuffer` fails; real error shown |
| d9c382b | Every apply step time-limited (`lib/timeout.ts` `withTimeout`) |
| 7d05c09 | Phone: only Egyptian mobile prefixes 010/011/012/015 |
| c0f0886 | Update floor uses this app's version in Expo Go |
| cc75566, a20ee97 | Push token request bounded; push re-registration loop stopped |
| 00eaf88 | Company document upload uses the same read fallback/time limits |
| 1ef9095 | All `/auth/v1` requests aborted after 20 s |
| 62f62df | DB 350: revoke anon EXECUTE on `my_company_id()` (applied to prod) |
| b2f1113 | Apply success screen: job/company/date summary card removed |
| d2a181d | Native alerts: Cancel on the right in Arabic (button order by device language, `lib/dialog.ts`) |
| c565be5 | DB 351: deleting an application deletes its candidate notifications; 11 stale removed (applied to prod) |
| 383e74b | Notifications: swipe-to-delete (+VoiceOver action) and clear-all with confirm (RLS `notifications_delete_own`) |
| 881e39f | 8 more Modals set `direction: appDirection` (guard test `tests/rtl-modals.test.ts`) |
| 06c3c73 | Employer applicant search tolerates Arabic spelling variants |
| 64622ba | Reset password: `same_password` message; shared GoTrue error mapping |
| 7dd5da0 | Two-step code: 429 "too many tries" said as such, code kept |
| bce9f60, bf03953, ab8dad0 | Saved-tab note sheet: drawn once at root, focuses after presentation, now a **top-anchored card** the keyboard can't cover; build marker on Account |

## The admin console, on both clients (October 2026, branch `claude/tender-davinci-dzouqf`)

Who is an admin: **only `k4hosting@gmail.com`** (promoted 2026-10-22, has a verified authenticator). The 15 `@demo.test` accounts that shipped with the public demo password are **banned** (`auth.users.banned_until = 2999-12-31`) and `admin@demo.test` was demoted; nothing of theirs was deleted, so 14 demo listings are still on the public board and 4 real applications went to demo companies (see Open items).

- **Website** `/admin/**` — unchanged in shape. `requireAdmin` sends an admin without an authenticator to enrol (`ADMIN_MFA_REQUIRED`, on by default in production) and one with an unused authenticator to the challenge; `is_admin()` (migration 311) refuses an enrolled admin at aal1 regardless. The **accounts page** (`/admin/users`, `/admin/users/<id>`) is now the users-management system: a "Sign-in blocked" list view, and an account file in four tabs (`?tab=overview|activity|security|record`) with every lever: approve / hold / suspend / restore, **make or remove admin**, **block or allow sign-in**, **sign out everywhere**, reporting restriction, contact revealed for a reason, notes.
- **Database** — migration **352** (`accounts_managed_from_one_place`): `admin_set_role`, `admin_set_sign_in_block` (writes `auth.users.banned_until` and deletes the account's `auth.sessions` by dynamic SQL — those tables are GoTrue's; the test DB stubs `auth.users` without `auth.sessions`, so the lever ends 0 sessions there), `admin_end_sessions`, `admin_user_activity`, and wider `admin_search_users` (+`p_blocked`; the 5-argument signature is **dropped**) and `admin_user_facts`. Rules: never yourself; an admin's sign-in is not blocked (demote first); only moves that make or unmake an admin; every call behind `admin_begin()` with a reason and an audit row. Tests: `pnpm test:admin` (section "accounts managed from one place"). **Not yet applied to production** — apply when the branch merges (`pnpm db:apply` or the Supabase MCP `apply_migration`).
- **iOS app** — an **Admin** tab for `role = 'admin'` (`mobile/src/lib/tabs.ts`; an admin who runs a company gets it in the directory's place, and the directory opens inside it: route group `(consultants,admin)`). Screens under `mobile/src/app/(tabs)/(admin)/admin/`: overview (`admin_overview`, the tab's badge), listings queue + one listing's review, reports (two queues: new / under review), accounts (list + file), companies' papers. Reads go to Supabase under the admin's session (`mobile/src/features/admin/{queries,accounts}.ts`); **writes are the website's own admin actions** through `/api/mobile/v1/actions`, exactly the names in `ADMIN_ACTIONS` (`src/lib/mobile-api/contract.ts`), each wrapped in `forAdmins()` (`registry.ts`) which applies the website's console rule to the bearer token (`src/lib/mobile-api/admin-door.ts`: aal2 when a factor exists, else refused while `ADMIN_MFA_REQUIRED` — the app reads that flag from `/config`). `scripts/mobile-api.test.mjs` pins the list and the door; `scripts/e2e/journeys.mjs` and `scripts/mobile-api.smoke.mjs` assert the door over HTTP. Every lever opens one confirmation sheet (`mobile/src/components/admin/decision-sheet.tsx`, host at the root) and says "done" only after the website answered `ok`. Tests: `mobile/tests/admin.test.tsx`, `mobile/tests/admin-accounts.test.tsx`. Docs: `docs/mobile.md` ("The admin console in the app"), `docs/security/THREAT_MODEL.md` §6.
- **Signing in as the admin**: website — Google, the authenticator code, `/admin`. App — the same Google sign-in; the app asks for the code (`mobile/src/app/mfa.tsx`) and the Admin tab appears. Reaches phones by the Expo Go OTA when `main` changes (no `EXPO_TOKEN` was available in the session that built this).

## Open items

1. **Note sheet (ab8dad0)** — awaiting user confirmation on device that the top-anchored card is no longer covered by the keyboard (two earlier attempts weren't enough in Expo Go). Ask for the Account build marker first.
2. **CV uploads** — confirm new objects land in storage bucket `cvs` and `applications` rows reference them after real applies (read-only SQL on `storage.objects` / `applications`).
3. **Supabase logs** — the MCP `query_logs` returned "Backend error" all session; production errors were not reviewed.
4. **Leaked-password protection** — manual: Supabase dashboard → Authentication → Providers → Email → "Prevent use of leaked passwords".
5. **Saved notes and reminders are device-only** (`bc.saved-notes.v1:<user>` in local storage) — lost on reinstall/new phone. By design so far.
6. **TestFlight / App Store** — no iOS build has ever been made; EAS holds **no iOS credentials** and `eas.json` submit has no `ascAppId`/`appleTeamId`. Blocked until the user has a paid Apple Developer Program membership. Then, on their machine: `cd mobile && npx eas-cli@latest build --platform ios --profile production --auto-submit` (Apple ID + 2FA once; EAS creates and stores cert/profile/ASC key), or provide an ASC API key (.p8, Key ID, Issuer ID), Team ID and the App Store Connect app's Apple ID for non-interactive builds. Details: `docs/app-store.md`. Store builds take OTAs on channel `production`, not `expo-go`.
7. **Unused packages** — `react-native-maps`, `expo-calendar`, `react-native-qrcode-svg` (added in 39e89ee) are imported nowhere; remove or use, and regenerate licences.
8. Not verified on a real device or store build: anything — all testing this session was Jest + Expo Go reports from the user.
9. **Migration 352** must be applied to production when the admin branch merges (see above). The website's users page calls `admin_search_users` with named arguments, so it works against the old function until then, minus the "Sign-in blocked" view.
10. **Demo data still live**: 14 demo listings on the board and 4 real applications sent to demo companies; `scripts/remove-demo.mjs` (needs a service key and DB URL) takes them down. The new admin's own public consultant profile (`consultant-33529768`) is still listed — hide it if they do not want it seen.
11. **Admin console parity in the app**: the app has the queues and the accounts; search, the audit log, appeals, applications, consultant profiles, one company's page, taxonomy, email and operations are still website-only (the app's overview links to them). `docs/prompts/mobile-admin-parity.md` is a complete build prompt for the rest, written from an inventory of every website admin page and lever.

## Gotchas

- **RTL in Expo Go**: Expo Go doesn't reliably apply `forcesRTL`, so `I18nManager.isRTL` can't be trusted. Use `appDirection` from `mobile/src/lib/direction.ts`; the root view sets `direction` on everything. **A `Modal` does not inherit it** — every sheet's outermost view must set `direction: appDirection` (enforced by `tests/rtl-modals.test.ts`). React Native mirrors `textAlign: 'left'` for `Text` under RTL (it means "start"), but **not** for `TextInput` (physical) — see `TextField`. `SwipeRow`/`SwipeCard` use physical sides on purpose.
- **Sheets**: open via `useSheet()` (`lib/use-sheet.ts`), which waits for any closing sheet (`lib/sheet-gate.ts`, iOS refuses to present over a dismissing one). Draw sheets at the root (host pattern: `VerifiedExplainerHost`, `NoteSheetHost`), not inside list rows — rows re-render and take the Modal with them.
- **Hangs**: supabase-js auth calls share a lock; a stuck refresh blocked sign-out and storage. Wrap anything that can stall in `withTimeout` (`lib/timeout.ts`); auth fetches are bounded in `lib/supabase.ts`, data requests by `db.timeout`, website calls in `lib/api.ts`.
- **Egypt**: time zone `Africa/Cairo` (has DST again), Western digits (`-u-nu-latn`), `ar-EG`/`en-GB`, EGP. Parse user digits with `westernDigits`. Mobile numbers: `+20` + 10/11/12/15 (`src/lib/phone.ts`).
- **Supabase advisors**: the 13 anon-executable SECURITY DEFINER helpers (`is_admin`, `owns_job`, `current_role_of_user`, …) are used in RLS policies that anon evaluates (public jobs/companies/storage) — revoking them breaks logged-out browsing. `submit_support_request`/`record_support_event` are intentionally anon (rate-limited). All `admin_*` call `admin_begin()` → `is_admin()`. Every definer function sets `search_path`.
- **Admin levers from the app**: add a lever by (1) the server action in `src/lib/actions/admin.ts` (or `moderation.ts`), (2) its entry in `MobileActions` + `ADMIN_ACTIONS` in `contract.ts`, (3) `name: { run: forAdmins(action) }` in `registry.ts` — `scripts/mobile-api.test.mjs` fails if any of the three is missing or the entry is not behind `forAdmins`, (4) a `Lever` kind in `mobile/src/features/admin/levers.ts`. Never expose `createAdminClient` through the registry.
- **`auth` schema from SQL**: only migration 352 writes to it (`banned_until`, sessions, refresh tokens), by dynamic SQL guarded with `to_regclass`, as the `postgres` role. Reading `auth.users` from definer functions has precedent (201, 305, 318).
- **Arabic search**: web job search folds spelling (`src/lib/search/arabic.ts`); ilike lists use `looseArabicNeedle`-style patterns.
- Commits in this repo are small, one fix each, with a descriptive message; keep `pnpm check` green before pushing.
