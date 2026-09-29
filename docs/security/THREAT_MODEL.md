# Brokers Connect — Threat model and data classification

_Hardening round, September 2026. Written from the code as it is, not from a diagram of how it was meant to be._

## 1. What the system is

A Next.js 15 application on Vercel, one Supabase project (Postgres, Auth, Storage), Resend for email, Paymob wired but dormant. Every page renders on the server; the browser talks to Supabase Auth directly for sign-in, sign-up and password reset, and to Supabase Storage directly for CV and verification-document uploads. Everything else goes through server actions and route handlers, which read and write Postgres **as the signed-in user** through PostgREST with row-level security on every table. The service role is used only for cron jobs, email, moderation-adjacent lookups and, since this round, the two things a visitor cannot be trusted to call (the directory functions and the view counter).

The important consequence: **the Next server is not a security boundary either.** A signed-in user holds a JWT and can call PostgREST directly with the public anon key. Every rule that matters is therefore in the database — a policy, a trigger, or a `SECURITY DEFINER` function — and the application layer only adds friction, observability and the checks that need a server (byte sniffing, image re-encoding, Turnstile, rate counters for server-only paths).

## 2. Data classification

| Class | Data | Where | Who may read |
|---|---|---|---|
| **Public** | Taxonomies; live/expired/closed listings; company cards (name, logo, about, website, verification badge, district); anonymised consultant cards (headline, tracks, areas, years, availability); blog; legal pages | `jobs`, `companies`, `agent_profiles` via `search_agents()` | Everyone |
| **Public by the person's choice** | Consultant name and photo when `visibility = 'public'` | `profiles` via directory functions | Everyone (server-served) |
| **Authenticated / employer-only** | Consultant name and photo when `verified_employers_only`; applicant list per listing; applicant name, phone, CV, notes; company documents; company members; orders | `applications`, `profiles` (applicant policy), `application_notes`, `company_documents`, `company_members`, `orders` | Members of the company that owns the listing, in good standing; company admins for documents and orders |
| **Highly sensitive — contact** | Consultant WhatsApp number; consultant CV | `profiles.whatsapp_phone`, `agent_profiles.cv_path` | Only through `reveal_agent_contact()`: signed in, employer in good standing with a company (or admin/owner), card open to the viewer, within per-person and per-company allowances; every reveal is written to a ledger |
| **Private to the person** | Own profile, own applications and their status, saved jobs/searches, notifications, own reveal ledger, data export | Owner policies | The account only (and admins) |
| **Platform-private** | `unsubscribe_token`, reviewer's `approval_note`, `email_log`, `email_suppressions`, `agent_profile_views`, `rate_limit_hits` | `profile_private`, log tables with no user policies | Service role; admins read `profile_private.approval_note`, `audit_log`, `security_events` |
| **Admin** | Moderation queues, all profiles, all documents, audit trail, security events, abuse limits | Admin policies (`is_admin()`, which requires a second factor once one is enrolled) | Admins at AAL2 |
| **Secrets** | Service-role key, Resend key and webhook secret, Paymob HMAC, cron secret, Turnstile secret, security salt | Vercel environment | The deployment only; `/api/health` reports presence, never value |

## 3. Trust boundaries

```
Browser ──(anon key + user JWT)──► Supabase Auth / PostgREST / Storage   ← the boundary that matters
Browser ──(HTTPS)──► Vercel edge ──► Next server actions / routes ──(user JWT)──► PostgREST
                                                  └──(service role)──► PostgREST / Storage   (narrow, listed below)
Resend / Paymob ──(signed webhooks)──► Next route handlers ──(service role)──► RPC
Vercel Cron ──(bearer secret)──► Next route handlers ──(service role)──► RPC
```

Service-role call sites (exhaustive, as of this round): cron routes; email sending and recipient lookup; unsubscribe token lookup; `user_id_by_email` for team invites (admin-gated, rate-limited); signed CV URLs after an RLS-authorised read; account deletion of the caller's own files; image re-encode uploads into the caller's own folder; `rate_limit_hit` / `record_security_event`; directory functions and view counter **for signed-out visitors only**; Paymob settlement.

## 4. Adversaries and their goals

| Adversary | Goal | Primary controls (this round in bold) |
|---|---|---|
| **Contact harvester** (scraper, fake employer) | Every consultant's WhatsApp number and CV | **No contact on any card or list; reveal function with auth + good standing + visibility + hourly/daily/company allowances + ledger; directory functions return no contact and no locked slug, so paging them yields only what the page shows; locked cards keyed by id, not name-slug; CV route rate-limited** |
| **Credential stuffer / brute forcer** | Account takeover | Supabase Auth rate limits (configured — see SUPABASE_SETTINGS.md); **Turnstile token on sign-in/sign-up/reset verified by Supabase Auth**; **progressive pause + visible challenge after repeated failures**; **failed sign-ins recorded as hashed events**; **password change/recovery revokes other sessions**; **admin MFA enforced in `is_admin()`** |
| **Enumerator** | Which emails/phones have accounts; who is on the directory | Neutral reset message; **member-lookup oracle restricted to company admins, 20/day, audited**; **locked consultant handles are opaque ids**; **public buckets no longer list** |
| **Fake employer / scam recruiter** | Publish a fake listing, collect applicants' numbers | Manual account approval before posting; moderation before publish; **daily listing cap (5 unverified / 20 verified), third-copy refusal**; reports + take-down; **suspension now revokes all data access, not just listings**; **`javascript:` links refused at the column and at render** |
| **Application spammer** | Flood employers | Approved-candidate policy; one application per listing; **8 per 10 min and 30 per day, locked against races, `created_at` stamped by the server** |
| **Privilege escalator** | Admin, verified, credits, featured, publication window | Guard triggers on UPDATE (existing); **INSERT guards that null the server's columns (dates, view count, review fields)**; **slug frozen; district/track/type/band edits re-enter review** |
| **Insider / stolen admin session** | Everything | **`is_admin()` requires AAL2 once a factor exists; console forces enrolment in production; every admin decision in `audit_log` with actor and before/after** |
| **Hostile uploader** | Serve HTML/SVG/executables from our origin; poison images; exhaust storage | Bucket MIME/size limits (existing); **magic-byte verification of CVs and documents before a row points at them; images decoded and re-encoded to WebP on the server (EXIF stripped, bombs refused); 20 objects per folder; path shape `<owner>/<file>` enforced in code and in CHECK constraints (`..` traversal closed)** |
| **Resource exhauster** | Slow queries, huge pages, full scans | Page-size caps (existing), **companies query/page caps**; **`statement_timeout` 5 s anon / 10 s authenticated**; **export 5/day, CV downloads 60/hour**; Vercel WAF rate rules (EDGE_WAF.md) |
| **Webhook forger / replayer** | Mark mail delivered, suppress addresses, mint credits | Svix signature with tolerance; Paymob HMAC; `settle_order` row lock + pending check; **settlement bound to signed Paymob order id, amount and currency; refunded/voided never succeeds; cron bearer compared in constant time** |
| **Team hijacker** | Add a victim to attacker's company so their console acts for it | **One company per account enforced by trigger; member lookup admin-only and rate-limited** |

## 5. What is deliberately out of scope this round, and why

- **Malware scanning of uploads.** No scanning engine is in the stack. Files are recognised by type and images are re-encoded; a well-formed hostile PDF is not detected. CVs are only ever served through five-minute signed URLs to entitled, rate-limited viewers, which bounds the blast radius. See the report's "remaining risks".
- **Proxying auth through our server.** Sign-in/sign-up/reset stay browser→Supabase Auth so that GoTrue's per-IP limits and CAPTCHA apply to the real client and cannot be bypassed by skipping our site.
- **Per-IP limits in Next middleware.** Vercel functions are stateless and a database round trip per page view is the wrong cost; IP-level limits belong at the Vercel firewall (documented) and, for the directory, in the functions themselves.
- **Cloudflare.** DNS resolves straight to Vercel (216.150.x.x); there is no Cloudflare zone in front. The edge layer is Vercel's firewall. Turnstile is used because it is free and verified natively by Supabase Auth, and needs no DNS change.

## 6. The iOS app (added with the mobile API, September 2026)

A second client, built from `mobile/` with Expo. It changes no rule in the database and adds one door.

```
iOS app ──(anon key + user JWT)──► Supabase Auth / PostgREST / Storage     same boundary as the browser
iOS app ──(Authorization: Bearer <user JWT>)──► /api/mobile/v1/* ──(that JWT)──► PostgREST
                                                   └── the website's own server actions, unchanged
```

- **Reads** go straight to PostgREST under the user's JWT, exactly as a browser could, so nothing new is exposed: the app is one more holder of a JWT, which section 1 already assumes anyone can be.
- **Writes** go through `POST /api/mobile/v1/actions/<name>`, which runs the same server action the website's form runs (`src/lib/mobile-api/registry.ts`). The emails, magic-byte checks, re-encoding, slugs, sanitising and server-side rate counters therefore apply to the app too; bypassing them is no easier than it was.
- **No cookie is ever a session on a mobile route.** Inside a mobile route, `createClient()` builds the bearer client or the anonymous one and never reads cookies (`src/lib/mobile-api/context.ts`), so a cross-site form post that carries a visitor's cookies reaches these routes signed out. Tokens are verified once per request against Supabase Auth; a refusal is 401, an auth outage 503.
- **The registry is the allowlist.** Every action the app may call is named there and nothing else is reachable; no admin action and no checkout, which a test pins (`scripts/mobile-api.test.mjs`). An unknown name is 404, a prototype key included.
- **Public reads** (the board, companies, browse counts) run signed out whatever the request carries and may be cached for a minute; anything viewer-dependent is `no-store`.
- **The app holds** the publishable key and the site URL, nothing else. Its session is stored encrypted: the AES key in the iOS Keychain (`expo-secure-store`), the ciphertext in app storage.
- **At the edge**, `/api/mobile/*` is rate-limited with deny, never challenge (a native client cannot answer a challenge), and is exempt from Bot Protection; Attack Challenge Mode cuts the app off for its duration (EDGE_WAF.md).
- **Email links** land on `/auth/confirm`, which verifies a token hash rather than exchanging a code, so they work on the device and in the app where they are opened. A GET only draws a "Continue" button (mail scanners that open every link cannot spend it); the POST that spends it is refused unless the browser says it came from this site (`Origin` / `Sec-Fetch-Site`), which closes login CSRF — another page cannot sign a visitor into an attacker's account with the attacker's token. The destination is read from the link and passes the same `safeNext` rule as every other redirect.
- **The Sign in with Apple key** (`APPLE_PRIVATE_KEY`) lives only on the server, where `deleteMyAccount` uses it to revoke a deleting Apple user's grant with a code the app has just obtained from Apple; the code is single-use and short-lived, and nothing Apple returns is stored or logged.
- **Carrier NAT.** Egyptian mobile carriers put many phones behind one address. Per-IP limits that are right for a browser can refuse a whole neighbourhood of app users, so the app's traffic is limited per account in the database first, and per IP only loosely.
