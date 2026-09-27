# Supabase dashboard settings this round depends on

Nothing here can be applied from a migration. Each item is a dashboard setting on the hosted project, listed in the order that matters, with how to confirm it took.

## Authentication → Attack Protection

| Setting | Value | Why |
|---|---|---|
| **Enable Captcha protection** | On, provider **Turnstile**, secret = the same `TURNSTILE_SECRET_KEY` set on Vercel | Makes a Turnstile token *required* on sign-up, sign-in with password, password reset and resend — for the browser and for any script calling `auth/v1/*` directly. The forms already pass the token when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set. **Set the Vercel variables and redeploy before switching this on**, or sign-in breaks for everyone. |
| **Rate limits → Token refresh / sign-in per IP** | Keep defaults or lower (30 per 5 min) | GoTrue's own brute-force protection, keyed on the client's real IP. |
| **Rate limits → Emails sent per hour** | 30 (custom SMTP is configured) | Bounds reset/confirmation mail from one project; the app's own reset limiter is telemetry only. |
| **Leaked password protection** | On (Pro plan) | Refuses passwords found in breach corpora at sign-up and change. |
| **Minimum password length** | 10 | Forms enforce 8; raising the server side does not change the UI copy — update `validation.passwordShort` in `messages/*.json` when you raise it. |

Confirm: `curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "content-type: application/json" -d '{"email":"nobody@example.com","password":"x"}'` must answer `captcha verification process failed` once the toggle is on.

## Authentication → Multi-factor

| Setting | Value |
|---|---|
| **TOTP** | Enabled |
| **Phone** | Disabled (no SMS provider) |

Then, as each admin: `/dashboard/account` → *Two-step verification* → set up. From that moment the database refuses that admin's session at AAL1 (migration 210), and the console routes them to the code prompt. `ADMIN_MFA_REQUIRED=false` on Vercel is the escape hatch **only** for an admin who has not enrolled yet; it does nothing for one who has.

## Authentication → Sessions

| Setting | Value | Why |
|---|---|---|
| **Refresh token rotation** | On (default) | A stolen refresh token is single-use. |
| **Reuse interval** | 10 s | Default. |
| **Time-box user sessions** | 7 days for everyone is reasonable; admins are covered by MFA rather than by a shorter box | Optional (Pro). |
| **Single session per user** | Off | Recruiters use two devices. Password change already ends other sessions from the app. |

## Authentication → URL configuration

Site URL = production origin. Redirect allow-list = `https://www.brokersconnect.net/auth/callback` (and the preview pattern if previews need sign-in). Nothing else — the callback validates `next` internally.

## Database → Settings

| Setting | Value |
|---|---|
| **Connection pooling** | Transaction mode on port 6543 for the app (the Supabase JS client uses PostgREST, so this only matters for `DATABASE_URL` consumers, which are the scripts) |
| **Statement timeout** | Set per role by migration 209 (`anon` 5 s, `authenticated` 10 s). Confirm with `select rolname, rolconfig from pg_roles where rolname in ('anon','authenticated')`. PostgREST picks it up on its next connection; `notify pgrst, 'reload config'` is issued by the migration. |
| **Point-in-time recovery** | Enable (Pro add-on). Daily backups alone give a 24-hour RPO; PITR gives minutes. See RUNBOOKS.md → Backups. |

## Storage

Buckets are created by migration 06/35 with size limits and MIME allow-lists. Nothing to change in the dashboard, but confirm after deploy that `avatars` and `company-logos` still serve objects publicly (they do: public buckets do not consult the SELECT policy that migration 208 removed — only listing needs it).

## Logs & advisors

After applying migrations 202–110 run **Database → Advisors → Security**. Expected: zero errors. The remaining warnings will be the `SECURITY DEFINER` functions this schema uses on purpose (pinned by `schema.test.mjs`), and — if it appears — "auth users exposed" is a false positive for `user_id_by_email`, which is service-role only.

## Alerts (Supabase → Project Settings → Integrations, or the Log Drains add-on)

Wire these to the team's channel:

- Database CPU > 80 % for 5 min; connections > 80 % of pool.
- Auth: sign-in failures > 200/hour (log query `event_message ~ 'invalid_credentials'`).
- Storage egress spike (> 3× the 7-day median).

The application's own signals are on `/admin/security` and in `security_events`; see the report for what to page on.
