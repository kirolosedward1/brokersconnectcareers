# Handoff — Brokers Connect Careers

State as of 2026-10-19 (main at `ab8dad0` before this file). No secrets in this file; none belong in the repo.

## What it is

Arabic-first job board for Egypt's real-estate brokerage market (candidates = sales consultants, employers = brokerages).

- **Web** (repo root): Next.js 15 + TypeScript + Supabase, pnpm, Node 22 (`.nvmrc`). Deployed by **Vercel** on every push to `main`.
- **iOS app** (`mobile/`): Expo SDK 57 / React Native, expo-router, TanStack Query, Supabase JS. Talks to Supabase directly (RLS) and to the website's `/api/mobile/v1/*` for server actions.
- **Database**: Supabase project ref `hiwdhicwsohbipxzazmb`. Schema lives in `supabase/migrations/` (numbered `20260101000NNN_*.sql`; latest `…351`).

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

- **Push to `main`** = deploy, on both sides. Vercel builds the web; `expo-go.yml` ("Over the air") runs the app's checks, waits for production to serve the same push (`/api/mobile/v1/config` → `commit`), then publishes an OTA on **both** the `expo-go` channel and the `production` channel when `mobile/**`, `src/lib/**` or `messages/**` change. A store build, once one exists, takes it from its next launch. Account's footer shows `<update id> · <app commit> · website <web commit>`.
- **Website ⇄ app parity checks**: `pnpm test:route-parity` (every website page is an app screen, a remap in `mobile/src/lib/links.ts`, or listed as website-only); `mobile.yml`'s `website` job runs the website checks that read `mobile/` on mobile-only changes.
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

## Open items

1. **Note sheet (ab8dad0)** — awaiting user confirmation on device that the top-anchored card is no longer covered by the keyboard (two earlier attempts weren't enough in Expo Go). Ask for the Account build marker first.
2. **CV uploads** — confirm new objects land in storage bucket `cvs` and `applications` rows reference them after real applies (read-only SQL on `storage.objects` / `applications`).
3. **Supabase logs** — the MCP `query_logs` returned "Backend error" all session; production errors were not reviewed.
4. **Leaked-password protection** — manual: Supabase dashboard → Authentication → Providers → Email → "Prevent use of leaked passwords".
5. **Saved-job notes live with the bookmark since migration 353** (`saved_jobs.note`, `setSavedJobNote`): shown on the website's /dashboard/saved and in the app; notes kept on a phone before are carried over once (`carryDeviceNotes`). **Reminders stay device-only** (`bc.saved-reminders.v1:<user>`) — they are local notifications by nature.
6. **TestFlight / App Store** — no iOS build has ever been made; EAS holds **no iOS credentials** and `eas.json` submit has no `ascAppId`/`appleTeamId`. Blocked until the user has a paid Apple Developer Program membership. Then, on their machine: `cd mobile && npx eas-cli@latest build --platform ios --profile production --auto-submit` (Apple ID + 2FA once; EAS creates and stores cert/profile/ASC key), or provide an ASC API key (.p8, Key ID, Issuer ID), Team ID and the App Store Connect app's Apple ID for non-interactive builds. Details: `docs/app-store.md`. Store builds take OTAs on channel `production`, not `expo-go`.
7. **Unused packages** — `react-native-maps`, `expo-calendar`, `react-native-qrcode-svg` (added in 39e89ee) are imported nowhere; remove or use, and regenerate licences.
8. Not verified on a real device or store build: anything — all testing this session was Jest + Expo Go reports from the user.

## Gotchas

- **RTL in Expo Go**: Expo Go doesn't reliably apply `forcesRTL`, so `I18nManager.isRTL` can't be trusted. Use `appDirection` from `mobile/src/lib/direction.ts`; the root view sets `direction` on everything. **A `Modal` does not inherit it** — every sheet's outermost view must set `direction: appDirection` (enforced by `tests/rtl-modals.test.ts`). React Native mirrors `textAlign: 'left'` for `Text` under RTL (it means "start"), but **not** for `TextInput` (physical) — see `TextField`. `SwipeRow`/`SwipeCard` use physical sides on purpose.
- **Sheets**: open via `useSheet()` (`lib/use-sheet.ts`), which waits for any closing sheet (`lib/sheet-gate.ts`, iOS refuses to present over a dismissing one). Draw sheets at the root (host pattern: `VerifiedExplainerHost`, `NoteSheetHost`), not inside list rows — rows re-render and take the Modal with them.
- **Hangs**: supabase-js auth calls share a lock; a stuck refresh blocked sign-out and storage. Wrap anything that can stall in `withTimeout` (`lib/timeout.ts`); auth fetches are bounded in `lib/supabase.ts`, data requests by `db.timeout`, website calls in `lib/api.ts`.
- **Egypt**: time zone `Africa/Cairo` (has DST again), Western digits (`-u-nu-latn`), `ar-EG`/`en-GB`, EGP. Parse user digits with `westernDigits`. Mobile numbers: `+20` + 10/11/12/15 (`src/lib/phone.ts`).
- **Supabase advisors**: the 13 anon-executable SECURITY DEFINER helpers (`is_admin`, `owns_job`, `current_role_of_user`, …) are used in RLS policies that anon evaluates (public jobs/companies/storage) — revoking them breaks logged-out browsing. `submit_support_request`/`record_support_event` are intentionally anon (rate-limited). All `admin_*` call `admin_begin()` → `is_admin()`. Every definer function sets `search_path`.
- **Arabic search**: web job search folds spelling (`src/lib/search/arabic.ts`); ilike lists use `looseArabicNeedle`-style patterns.
- Commits in this repo are small, one fix each, with a descriptive message; keep `pnpm check` green before pushing.
