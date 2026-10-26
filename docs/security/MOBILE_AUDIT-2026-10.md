# Mobile security audit — October 2026

_The iOS app (`mobile/`), the `/api/mobile/v1` door it talks to, and what the two share with the website, read against OWASP MASVS v2 (storage, crypto, auth, network, platform, code, resilience, privacy). The September report (`SECURITY_REPORT.md`) covers the website and the database; this one covers what that report predates._

## What was already right

Nothing below needed changing, and each was checked rather than assumed.

| Area | What the code does |
|---|---|
| Secrets in the app | Only the publishable Supabase key and the site URL (`mobile/src/lib/env.ts`, `eas.json`). No service-role key, API key or private key is tracked anywhere in the repository or its history; `google-services.json` and the Apple `.p8` are build- and server-side only. |
| Token storage | The session is AES-GCM sealed; the 256-bit key sits in the Keychain as `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, so a backup restored elsewhere cannot open it (`session-storage.ts`). Nothing personal is persisted by the query cache — only taxonomies and the public opening reads (`query.ts`). Picked files and exports are cleared from the cache when the person changes (`personal-cache.ts`). |
| Auth flows | PKCE for Google; Apple with a hashed nonce; email links verified in a throwaway client; refresh failures told apart from refusals; sign-out unregisters the phone first. |
| The door | Bearer only — the cookie client is never built inside a mobile route, so a cross-site post reaches it signed out. The registry is the allowlist (no admin action, no checkout); prototype keys are 404; inputs are schema-checked. |
| Network | HTTPS only (ATS and Android defaults left on); `credentials: 'omit'`; time limits on every call; public reads run signed out so the CDN can never cache one person's answer. |
| Platform | Deep links resolve only the site's own hosts and pass the website's audience rules before a screen opens (`links.ts`). The captcha WebView may load the captcha page and Cloudflare's frames only, and parses the page's messages strictly. Push tokens are shape-checked in the database and capped at ten phones. Permissions are asked in context, never at launch; `SYSTEM_ALERT_WINDOW` is blocked. |
| CI | No `pull_request_target`; untrusted text reaches scripts through `env:`; secret-bearing jobs do not run for forks. |

## Found and fixed

| # | Sev. | Finding | Fix |
|---|---|---|---|
| 1 | **High** | **The second factor was asked only by the app's own screens.** `/api/mobile/v1/*` accepted any token the auth server accepted, at `aal1`, for an account with a verified authenticator: a stolen password, sent straight to the API, could do everything the account can — including `deleteMyAccount`, which erases it through the service role. The shared CV and export routes had the same gap for cookie sessions (the middleware never sees `/api`). | `src/lib/auth/second-factor.ts` `secondFactorDue()`; the door answers 403 `second_factor_required` where somebody is needed and runs the request signed out where nobody is (`http.ts`, the actions route); the CV and export routes refuse by token and by cookie; `deleteMyAccount` refuses on the website too, where a server action is reachable from any page. |
| 2 | **Medium** | **The website's own check trusted the cookie.** `mfa.getAuthenticatorAssuranceLevel()` with no argument reads the factor list from the copy of the user stored in the session cookie, which the browser holds: sign in with the password, empty `factors` in the cookie, and the middleware never sent the session to the challenge. | The middleware judges the user the auth server just returned (`getUser()`) and the token it accepted. Admins were never exposed — `is_admin()` checks the real factor in the database. |
| 3 | **Medium** | **Dependencies with published advisories:** `next` 15.5.24 (two cache-poisoning advisories, fixed in 15.5.27); `source-map-js` 1.2.1 under postcss, Tailwind and Metro (high, event-loop DoS); `shell-quote` 1.10.0 under React Native's dev tools (critical, command injection through `quote()`). | `next` 15.5.27; `overrides` for `source-map-js` ^1.2.2 in both roots and `shell-quote` ^1.11.0 in the app; licence lists regenerated. |
| 4 | **Low** | **The door's body limit counted after buffering.** A JSON or multipart body sent without `Content-Length` was read whole before its size was checked; only the platform's own cap stopped it. | Bodies are read as a stream and abandoned at the limit (256 KB JSON, 3 MB upload), then parsed from the counted bytes. |
| 5 | **Low** | **The app switcher showed the last screen.** iOS keeps a picture of the app for its switcher; for an employer that was an applicant's name, number or CV. | A cover (the page and the logo) whenever a signed-in app leaves the front. |
| 6 | **Low** | **No way to keep a phone left unlocked out of the account.** The Face ID purpose string and `expo-local-authentication` shipped for an app lock that had not been built. | "Lock the app" under Sign-in and security: Face ID or the passcode at launch and after a minute in the background, per person per phone; changing it asks first; signing out is the way past it. JavaScript only, so it ships over the air to builds already installed. |

Tests: `scripts/mobile-api.test.mjs` (the rule, the door, the middleware, deletion), `mobile/tests/app-lock.test.tsx` (cover, lock, switch).

## Left as they are, on purpose

- **The second factor in the database for every account.** Fix 1 closes every door the Next server owns; a password taken straight to PostgREST still reads what the account may read. Closing that is a restrictive policy on each personal table plus changes to both sign-in paths, already planned as its own release (`THREAT_MODEL.md` §5).
- **`android.allowBackup: false`.** Any change to `app.config.ts` changes the iOS fingerprint as well (the whole configuration is hashed), which would cut every installed build off from later over-the-air updates. The exposure is small — a backup carries the sealed session but never the Keystore key that opens it — so it goes in with the next native build.
- **`decode-uri-component` 0.2.2** (moderate, DoS) under expo-router's `query-string` 7: the fixed 0.5 is ESM-only and `query-string` `require()`s it, so the override would break every link the app opens. Waits on expo-router.
- **No fix published yet:** `node-forge` in the Expo CLI (build-time), `braces` and `sprintf-js` under Jest (test-time). `uuid` under `xcode` is reported for v3/v5/v6 into a buffer; xcode calls v4.
- **Certificate pinning.** Supabase and Vercel rotate certificates on their own schedule; a pinned app stops working the day they do. ATS and the system trust store are the control.
- **Jailbreak and tamper detection.** Bypassable on the devices it targets, and the data a modified app could reach is the account's own — every rule that matters is in the database.
- **Signed over-the-air updates** (`expo-updates` code signing). Worth turning on with the next native build: it needs a key pair the owner keeps outside the repository, the certificate in `app.config.ts`, and `scripts/publish-update.mjs` signing each update. Until then an update is as trustworthy as the Expo account that publishes it — keep that account on two-factor sign-in.
- **The cover and the lock sit under the root stack's sheets** (sign-in, onboarding, the code) and the pickers' page sheets. None of them shows anybody else's data.
