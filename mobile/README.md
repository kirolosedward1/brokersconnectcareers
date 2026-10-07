# Brokers Connect — iOS app

The phone version of [brokersconnect.net](https://www.brokersconnect.net), built
with Expo (SDK 57) and React Native, and connected to the same Supabase project
as the website. Arabic first, right to left, light and dark.

How it fits together, what it shares with the website and how it is released:
[docs/mobile.md](../docs/mobile.md).

## Run it

```bash
cd mobile
pnpm install
cp .env.example .env        # production's public values; point at staging if you have one
pnpm start:go               # then scan the QR code with the iPhone's camera, in Expo Go
```

Sign in to the same Expo account on both sides first — `npx expo login` here,
and the account icon in Expo Go — or an iPhone's Expo Go refuses the project.

Expo Go (free, from the App Store) is the quickest way to try it. What it
cannot do — Sign in with Apple, pushes, links that open the app — is listed in
`docs/mobile.md` ("Trying it in Expo Go"); for those, the app runs in a
**development build**:

```bash
npx eas-cli@latest build --profile development-simulator --platform ios   # for the iOS Simulator
npx eas-cli@latest build --profile development --platform ios             # for a registered iPhone
```

Install the build once; after that `pnpm start` serves the JavaScript to it.

## Check it

```bash
pnpm check        # typecheck, lint, the shared-code guard, and the Jest suites
pnpm export:ios   # bundle for iOS with Metro and Hermes, as a build would
```

CI runs both on every pull request that touches `mobile/`, `src/lib/` or
`messages/` (`.github/workflows/mobile.yml`).

## Where things are

| Path | What |
| --- | --- |
| `src/app/` | Screens, by route. The paths mirror the website's: `/jobs`, `/jobs/<slug>`, `/companies/<slug>`, and the sign-in sheet at `/sign-in`, `/sign-up`, `/sign-in/forgot`. |
| `src/components/` | The app's UI kit (`ui/`) and the website's components, redrawn for the phone. |
| `src/features/` | Data hooks: the board, companies, the browse counts, the taxonomy; `auth/` for the captcha, Apple and Google, and where a sign-in lands. |
| `src/lib/` | The Supabase client, the API client for `/api/mobile/v1`, the session, links. |
| `src/i18n/` | The website's catalogue plus the app's own strings (`messages/`). |
| `src/theme/` | The design tokens (the brand in ivory and sapphire, black and champagne), the theme, Reduce Motion. |
| `tests/` | Jest: pure helpers, routing, and the real screens against fixtures. |
| `scripts/check-shared.mjs` | Fails if the app would bundle anything server-only from the website. |

`@/…` imports are the website's `src/…` (only `src/lib`, enforced by the guard);
`~/…` imports are this app's `src/…`.
