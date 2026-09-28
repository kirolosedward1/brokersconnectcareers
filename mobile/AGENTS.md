This is the Brokers Connect iOS app: an Expo/React Native app in `mobile/` that
shares code and a database with the Next.js website one directory up. Read
`../docs/mobile.md` before changing how the two connect.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json` (57).
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

Where the docs cannot be reached, the installed `.d.ts` files in `node_modules` are the reference.

## Commands

This project is its own pnpm root (`pnpm-workspace.yaml`, `nodeLinker: hoisted`), separate from the website's.

```bash
npx expo install <package>  # ALWAYS use instead of pnpm add for runtime packages — resolves SDK-compatible versions
                            # (EXPO_OFFLINE=1 when expo.dev is unreachable)
pnpm start                  # the dev server, for a development build
pnpm check                  # typecheck + lint + shared-code guard + Jest — run before declaring anything done
pnpm export:ios             # bundle for iOS, proves Metro and Hermes accept everything
```

## Rules for this app

- **Writes go through the website.** Every change to data is a server action called as
  `callAction(name, input)` (`src/lib/api.ts`) through `/api/mobile/v1/actions/<name>`, so emails,
  upload checks, rate limits and slugs happen exactly as on the site. The only direct writes are the
  notification read-state RPCs, the push registration RPCs and file bytes to Storage — see
  `../docs/mobile.md`.
- **Reads the website builds in TypeScript come from its GET endpoints** (`/api/mobile/v1/jobs`,
  `/companies`, `/browse`, …), typed by `../src/lib/mobile-api/reads.ts`. Simple per-user reads go
  straight to Supabase under row-level security.
- **Share, do not copy.** Filters, formatting, permissions, locale rules and the message catalogue are
  the website's own modules under `../src/lib` and `../messages`, imported with `@/`. The app's code
  is `~/`. `scripts/check-shared.mjs` fails if anything reachable imports server-only code, Next, or a
  package this app does not depend on.
- **Words come from the catalogue.** No user-facing string in code: the website's keys, or the app's
  own under `app.*` in `src/i18n/messages/{ar,en}.json` (same keys in both). Numbers inside Arabic
  sentences use `t.markup(…, markupTags)` so they are isolated left to right.
- **Right to left.** `textAlign: 'left'` is the logical start; use `ForwardChevron` for "onward".
- **Routes mirror the website's paths** so links, notification hrefs and pushes name the same screens.
  `+native-intent.tsx` maps incoming URLs (`src/lib/links.ts`); `tests/routing.test.tsx` covers where
  each lands.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Each tab is a route group with its own stack; listings, company pages and the bell's feed live in the
  shared group `(home,jobs,companies,applications,account)` so they open inside whichever tab the reader
  is in. Which tabs a person has is `src/lib/tabs.ts`; a hidden tab's screens do not exist for them, so
  open signed-in pages with `routeInside` / `openWhenReady`, never a bare path.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode required. Run EAS CLI as `npx eas-cli@latest <command>`. Profiles are in `eas.json` (`development`, `development-simulator`, `preview`, `production`).
Docs: https://docs.expo.dev/eas/index.md

- `ios/` and `android/` are generated (Continuous Native Generation). Never create or edit them by hand — configure native behaviour in `app.config.ts` and config plugins.
- After adding a library with native code, the app needs a new development build.
