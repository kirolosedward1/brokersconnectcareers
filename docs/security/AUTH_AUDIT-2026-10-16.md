# Authentication & session audit — 2026-10-16

Scope: registration, sign-in, email verification, password recovery, persistent
sessions, token refresh, account recovery and sign-out, on the website
(`src/`) and the iOS app (`mobile/`). Each area was read end to end and checked
against the installed `@supabase/auth-js` (website 2.112.4, app 2.117.2) and
GoTrue's own source where its behaviour decides the outcome.

Two bugs were found and fixed. Everything else held. The checks behind each
verdict are named so they can be re-run.

## Fixed

### 1. Password reset was impossible for an account with two-step verification

A reset link proves the inbox and nothing more, so the session it creates is
`aal1`. GoTrue refuses a password change at `aal1` on an account with a verified
factor (`internal/api/user.go`: `insufficient_aal`, "AAL2 session is required to
update email or password when MFA is enabled."). Both reset forms matched that
message against `/session|jwt|expired/` and told the person **"that link has
expired"**. Every new link gave the same answer, so these accounts had no way to
reset a password.

- Website: `/sign-in/new-password` sends such a session to the account page's
  code prompt first, which comes back to the form once the code is answered. The
  form also handles the refusal itself, for an authenticator added after the
  page was drawn.
- App: a reset link opens `/mfa` first (`then=new-password`), and the form sends
  a refusal there too.
- Tests: `mobile/tests/auth.test.tsx` "asks for the authenticator first…" (it
  fails on the old code). `scripts/second-factor.test.mjs` covers the page gate
  and the classifier.

### 2. Changing a password in settings failed on any session over a day old

`supabase/config.toml` has `secure_password_change = true`, and the
reauthentication email template is generated and installed. With that setting
on, GoTrue refuses a password change on a session older than 24 hours unless a
nonce is sent with it (`reauthentication_needed`). Nothing called
`auth.reauthenticate()`. Sessions persist for weeks on the web (cookie) and
indefinitely on the phone, so for most people the settings form answered
**"something went wrong"** every time.

- Both settings forms now respond to that refusal by emailing the code and
  showing a code field. They send the code back as the `nonce`, accept
  Arabic-Indic digits, and offer "send a new code".
- The refusals are read in one shared, pure place: `passwordRefusal()` in
  `src/lib/auth/errors.ts`, used by the website and the app. It reads GoTrue's
  stable `code` first and its prose only as a fallback.
- Tests: `mobile/tests/account.test.tsx` "asks for the emailed code…" (it fails
  on the old code). `scripts/second-factor.test.mjs` covers the classifier and
  the website form.

## Verified, no change needed

| Area | What holds | Where |
|---|---|---|
| Registration | Password typed twice, CAPTCHA token passed through, door role kept in metadata, "check your email" screen with a rate-limited resend | `auth-form.tsx`, `auth-email.ts` |
| Sign-in | GoTrue errors mapped by code to the catalogue; growing friction after failures; "resend confirmation" for an unconfirmed address; document navigation after sign-in (no router race) | `auth-form.tsx`, `lib/auth/errors.ts` |
| Email verification | Token-hash links, spent only by POST (mail scanners cannot burn them), same-origin check on the POST, every destination through `safeNext` | `app/auth/confirm/route.ts`, `lib/auth/confirm-link.ts` |
| Password recovery request | Same answer whether or not the address exists; per-address and per-IP limits that count both cases | `requestPasswordReset` |
| Open redirects | One `safeNext` rule (schemes, `//`, `\`, encoded and control-character forms), enforced by a test that reads every `location.assign` | `lib/safe-next.ts`, `pnpm test:auth` |
| Protected routes | Middleware prefix list, with a parity test against the filesystem; layouts re-check; RLS is the rule; admin needs `aal2` at the database (migration 311) | `middleware.ts`, `lib/auth.ts` |
| Mobile API | Bearer token checked against the auth server on every request; the cookie client is never built inside a mobile route (no CSRF through a browser's cookies); `session_not_found` read as refused, not an outage | `lib/mobile-api/*` |
| Persistent sessions | Cookie `Secure` in production. On the phone: AES-GCM sealed session, key in the Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (a backup restored to a new phone signs in again) | `cookie-options.ts`, `mobile/src/lib/session-storage.ts` |
| Token refresh | Middleware refreshes on every request and fails to anonymous, never to a 500. App refreshes only in the foreground, with a 10 s timeout. A 429 or a non-JSON 4xx on refresh is treated as no answer, not as a sign-out | `lib/supabase/middleware.ts`, `mobile/src/lib/supabase.ts` |
| Expired sessions | Server actions answering `unauthenticated` send the person to sign-in and back to the same page; the app's 401 → refresh → retry once | `lib/session-expired.ts`, `mobile/src/lib/api.ts` |
| Device restart | App reads the stored session without the network, so a person signed in stays signed in offline; the last known account draws the tab bar until the profile is read | `mobile/src/lib/session.tsx` |
| Network interruption | A refresh that cannot reach the server keeps the session; reads that would go out as nobody are refused as offline, not answered as an empty account | `mobile/src/lib/supabase.ts` |
| Multiple accounts | A different account signing in clears the cached data; an email link for another account asks before switching, naming both | `session.tsx`, `mobile/src/app/auth/confirm.tsx` |
| Sign-out | `scope: 'local'` (this device). The installed auth-js removes the local session even when the logout request fails; the app also clears its store itself after a timeout | `user-menu.tsx`, `app-shell.tsx`, `signOutHere()` |
| Password change / reset | Other sessions are ended (`scope: 'others'`) and a security email is sent | both forms, both platforms |
| Account recovery without the authenticator | The code screen names the support address | account page, `mobile/src/app/mfa.tsx` |

## Left for the dashboard (not checkable from the repository)

- **Secure password change** on the hosted project. The code above works either
  way: with the setting off, no code is ever asked for.
- **Minimum password length.** `SUPABASE_SETTINGS.md` recommends 10 on the
  server; the forms enforce 8 and the copy says 8. If the server is raised, the
  settings form now shows `validation.passwordShort` rather than "something went
  wrong", but that copy still says 8. Raise it in `messages/*.json` together with
  the server.
- **`package.json` floor for `@supabase/supabase-js`** is `^2.49.1`. The
  sign-out guarantee above relies on auth-js clearing the local session when the
  logout request fails, which the locked 2.112.4 does. Raise the floor the next
  time the lockfile is regenerated, so a fresh resolve cannot go below it.

## Not done here

No end-to-end run against a live Supabase project: `pnpm test:db` needs the
local stack, which this environment does not have. The flows above were
exercised through the app's Jest suite, which runs the real screens and real
supabase-js against a stand-in auth server, and through the website's
source-level tests.
