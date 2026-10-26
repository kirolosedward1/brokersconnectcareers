# Store readiness, October 2026

The release review before the first store submission: what was checked, what
was found and changed, the builds made, the submission materials, and what
only the owner can still do. Nothing has been submitted to either store.

Platforms: the website (Next.js on Vercel, live), the iOS app (Expo SDK 57,
first submission pending) and the Android app (same code, ready to build, not
yet on Google Play).

## How to repeat it

From the repository root, then from `mobile/`:

```bash
pnpm install --frozen-lockfile && pnpm build          # the website, as Vercel builds it
cd mobile && pnpm install --frozen-lockfile
pnpm check                                            # typecheck, lint, shared-code guard, update publishing, Jest
npx expo export --platform ios --platform android --output-dir dist
pnpm release:check --bundle dist                      # what a store build is made from, and the bundle
```

`pnpm release:check` (`mobile/scripts/release-check.mjs`) is new here, and CI
runs it after `export:ios` on every app change (`.github/workflows/mobile.yml`).

## What was checked, and the result (15–22 October)

| Area | Result |
| --- | --- |
| Website production build | `next build` passes with the production Supabase URL, publishable key and site URL; no source maps are shipped to browsers |
| App checks | `pnpm check` passes: typecheck, ESLint, shared-code guard, update-publishing check, licences, 45 Jest suites / 837 tests |
| App production bundles | iOS 7.1 MB and Android 7.4 MB Hermes bytecode, built with `NODE_ENV=production` |
| Identifiers | iOS bundle id and Android package `net.brokersconnect.app`, the same in both; scheme `brokersconnect` |
| Version | 1.0.0 in `app.config.ts`, `package.json` and the App Store listing; build numbers are kept by EAS (`appVersionSource: remote`, `autoIncrement`) |
| Signing | EAS-managed. The production profile signs for the App Store with production APNs (`aps-environment: production` in the generated entitlements); Android builds an `.aab` with the upload key EAS creates on the first build. No signing material is in the repository (`*.p8`, `*.p12`, `*.jks`, `*.keystore`, `*.mobileprovision` are ignored and none is tracked) |
| Environment | The app carries three public values only (`eas.json`): the production Supabase URL, the `sb_publishable_` key and `https://www.brokersconnect.net`. Production endpoints throughout; no staging or localhost address is configured |
| Credentials | No secret key, service-role token, private key, Resend/AWS/GitHub/Stripe token or committed `.env` file in tracked files; none in either app bundle (`release:check --bundle`, which was also shown to fail on a planted secret key and service-role token) |
| iOS release settings | `ITSAppUsesNonExemptEncryption` false; privacy manifest with no tracking and every collected type linked and for app functionality; purpose strings in Arabic and English for the photo library, camera and Face ID; no microphone; App Transport Security forbids arbitrary loads; associated domains for the production site |
| Android release settings | target SDK 36, minimum 24; App Links to the production site only; `SYSTEM_ALERT_WINDOW` and `RECORD_AUDIO` removed; storage permissions capped at Android 12; no permission that needs a Play declaration |
| Icons and launch screen | App Store icon 1024 × 1024 and opaque; Android adaptive icon and monochrome layer 1024 × 1024; launch screen image on the app's page colour |
| Over-the-air updates | production channel, fingerprint runtime version, the EAS project's update URL; a store build never waits at launch for an update |
| Development-only behaviour | The dev client's local-network keys are stripped from release builds by Expo's own build phase (checked in the generated Xcode project); `__DEV__` logging only; the email preview route is admin-only in production; the demo sign-in buttons need build variables production does not have — and now cannot appear on Vercel's production deployment even if those are set (below) |

## Changed in this review

- **Demo sign-in, defence in depth** (`src/components/auth/auth-form.tsx`).
  The one-tap demo buttons depended only on `NEXT_PUBLIC_DEMO_LOGIN` and
  `NEXT_PUBLIC_DEMO_PASSWORD` being absent from the production build. They now
  also require `NEXT_PUBLIC_VERCEL_ENV` not to be `production`, so a variable
  added there by mistake cannot bring back a button that signs anyone in as a
  shared account.
- **The release check** (`mobile/scripts/release-check.mjs`, `pnpm
  release:check`), in CI after the iOS bundle.
- **Google Play, never straight to the public**: `eas.json` →
  `submit.production.android` sends a submission to the internal track as a
  draft.
- **Google Play materials**: `docs/play-store.md` (identity, listing, App
  content, the IARC answers, Data safety, permissions, the steps in order);
  `mobile/store/play/listing.js` (the listing in Arabic and English, sharing
  the App Store's descriptions, held to Play's limits); the store icon and
  feature graphic in `mobile/store/play/`, drawn by
  `mobile/scripts/play-graphics.py`, which also fits the App Store
  screenshots to Play's proportions.

## Submission materials

| | App Store | Google Play |
| --- | --- | --- |
| Listing text | `mobile/store.config.js` (pushed with `eas metadata:push`) | `mobile/store/play/listing.js` (pasted into the Play Console) |
| Privacy answers | `docs/app-store.md`, "App privacy"; the manifest in `mobile/app.config.ts` | `docs/play-store.md`, "Data safety" |
| Age / content rating | 18+ (`advisory` in `store.config.js`) | IARC answers and 18+ target audience (`docs/play-store.md`) |
| Review instructions | `reviewNotes` in `store.config.js`; accounts from `pnpm review-accounts` | "App access" in `docs/play-store.md`, the same accounts |
| Screenshots | `.github/workflows/ios-screens.yml` → `store/` (6.9-inch) | the same set, fitted by `play-graphics.py --screens`, until Android screenshots exist |
| Icon, graphics | `mobile/assets/images/icon.png` | `mobile/store/play/icon-512.png`, `feature-graphic.png` |
| Privacy policy / deletion | `/privacy`, `/account-deletion` | the same |

## Not done here, and why

- **Signed store builds** were not made: `eas build` needs the owner's Expo
  login, and the iOS build an Apple Developer account. This environment has
  neither, and no macOS for a local iOS build. The native iOS build is
  compiled in CI on `main` (`ios-build` in `mobile.yml`); the configuration a
  signed build is made from was evaluated and generated here
  (`expo prebuild` for both platforms, inspected, then removed).
- **Screenshots** were not captured: the workflow runs on macOS runners
  against production, and production had no live listings when last checked
  (`docs/app-store.md`, "Before the first submission").
- **The live site** could not be reached from this environment (its network
  policy refuses the host), so the legal pages and the `.well-known` files
  were not fetched.

## Blocking, for the owner

The full ordered lists are `docs/app-store.md` ("Before the first
submission") and `docs/play-store.md` ("Before the first Android release").
What this review found still open:

1. **The website's server key.** On 22 October, Vercel's production
   environment held eight variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `BILLING_ENABLED`,
   `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `PAYMOB_API_KEY`.
   **`SUPABASE_SERVICE_ROLE_KEY` is not among them**: until it is set, account
   deletion answers "unavailable", CVs and documents do not open, and the
   crons, emails and pushes do nothing — App Review tries deletion, and
   reviewing the employer account opens a CV. Also missing:
   `SECURITY_SALT`, `RESEND_WEBHOOK_SECRET`, `APPLE_APP_ID` (without it
   links to the site do not open the app) and the four `APPLE_*` revocation
   values (required for deleting a Sign in with Apple account); and, if the
   CAPTCHA is on in Supabase, the Turnstile pair. Sensitive values cannot be
   read back, so check none of the eight is an empty string (README,
   "Give every variable a value, or do not create it").
2. **Real listings on production**, then the demo data off it
   (`pnpm remove-demo`).
3. **Apple Developer Program membership**, the APNs key and the Sign in with
   Apple key; then `pnpm release:check` and the production build.
4. **The legal pages reviewed by a lawyer** (`docs/legal.md`).
5. **A development build on a real iPhone** through the checklist in
   `docs/mobile.md`, then the review accounts, screenshots, the build, and
   `eas metadata:push` — and then the submission, by hand, when the owner
   decides.
