# Brokers Connect · بروكرز كونكت

A vertical job board and agent talent directory for the Egyptian real estate market.
Arabic-first, bilingual, Cairo-first. Employers pay per job post — billing is built
and reachable, priced at zero behind a flag until the board has candidate volume.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth,
Storage, RLS) · next-intl · Vercel

## Getting it running

```bash
pnpm install
```

Create a Supabase project, then copy `.env.example` to `.env.local` and fill in:

- the three values from **Project Settings → API**
- `DATABASE_URL` from **Project Settings → Database → Connection string → URI**
  (the *direct* connection, not the transaction pooler — the pooler rejects the
  multi-statement DDL these migrations contain)

Then, without needing Docker or the Supabase CLI:

```bash
pnpm db:push:url    # schema + taxonomies
pnpm db:seed:demo   # demo accounts and sample listings
pnpm doctor         # confirms all of the above actually took
pnpm dev
```

`pnpm doctor` checks the pieces in the order they break — env values, then the
REST API as an anonymous visitor (which also proves the grants and RLS are
right), then the schema, storage buckets, and auth.

Demo sign-ins are `employer@demo.test`, `employer2@demo.test`,
`candidate@demo.test` and `admin@demo.test`, all with password `password123`.

Google OAuth is optional; email/password works without it. To enable it, turn on
`Authentication → Providers → Google` in Supabase and add `<site>/auth/callback`
to the allowed redirect URLs.

### Seeding, and why it is split

`supabase/seed.sql` holds the taxonomies only. It is idempotent and safe to run
against production.

`supabase/seed-demo.sql` holds the demo application rows and deliberately does
**not** create auth users — it reads their ids from the caller. Creating users by
inserting into `auth.users` works against a stubbed local schema but not against
a real project: GoTrue also needs a matching `auth.identities` row whose columns
move between versions, and a hand-rolled insert yields an account that cannot
sign in. `scripts/seed-demo.mjs` creates them through the Auth admin API instead,
then runs the SQL half.

## Deploying to Vercel

Import the repository in Vercel; the framework preset and build command are
detected. Then set these environment variables (Settings → Environment
Variables), for Production and Preview:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `sb_publishable_…` key |
| `SUPABASE_SERVICE_ROLE_KEY` | the `sb_secret_…` key |
| `NEXT_PUBLIC_SITE_URL` | your production URL, e.g. `https://brokersconnect.com` |
| `CRON_SECRET` | any long random string |
| `BILLING_ENABLED` | `false` |

`DATABASE_URL` is **not** needed on Vercel — only the local setup scripts read
it. Keep it out of the deployment.

Three things that are easy to miss:

**Give every variable a value, or do not create it.** A variable added with the
name filled in and the value box left blank is not absent — it arrives as an
empty string, which is a value, and it silently wins over any fallback the code
has. Production ran this way and served `Sitemap: /sitemap.xml`.

**Set the Supabase variables before the first deploy, or expect a slow start.**
The build itself no longer fails without them — `/sitemap.xml` is prerendered
and degrades to static routes only — but every database-backed page will render
its error state until they are set.

**Set `NEXT_PUBLIC_SITE_URL` explicitly.** Without it the code falls back to
`VERCEL_URL`, which is the per-deployment hostname, so canonicals, `hreflang`,
the sitemap and the `JobPosting` structured data would all point at a preview
URL rather than your domain.

**Point Supabase Auth at the deployed site.** In Supabase → Authentication →
URL Configuration, set Site URL to your production URL and add
`https://your-domain/auth/callback` to the redirect allow-list. Until you do,
confirmation emails and Google sign-in will send people to `localhost:3000`.

The scheduled jobs are already declared in `vercel.json` (see
[Background work](#background-work)). Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically once that variable is set;
every cron route returns 401 to anything else.

## Background work

There is no queue service and no worker process. Background work is two
things: `after()` callbacks that run once a response has gone, and Vercel Cron
calling routes under `/api/cron/`. Everything durable about it lives in
Postgres.

**What stays synchronous, and why.** Every user-facing write — applying,
posting, moderating — commits before the response, because the person is
waiting on that answer. The email it causes is sent in an `after()` on the same
request: it is claimed in `email_log` first, so if the send fails or the
function is frozen mid-send the row is still there for the sweeper. New rows
are not eligible for a retry for five minutes, which protects one that is
mid-send. The job-view counter is also an `after()`, through the anon client,
because cookies are gone by then.

**Scheduled jobs.** Each route goes through `runScheduledJob`
(`src/lib/jobs/run.ts`): bearer-secret check, a per-job lease, a time budget of
`maxDuration` minus ten seconds, and a row in `job_runs` with start, finish,
duration, counts and a sanitised error.

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `email-retry` | every 10 min | Leases due outbox rows and retries them in place |
| `maintenance` | hourly at :41 | Relabels expired listings, dead-letters stale outbox rows, prunes `job_runs` older than 90 days, removes up to 100 orphaned uploads (replaced avatars/logos/CVs older than 7 days; `company-documents` is never touched) |
| `expire-jobs` | 01:00 daily | Expires listings; sends "expiring in 3 days" and "has expired (last 7 days)" notices |
| `daily-digest` | 06:00 daily | Applicant digests (window starts at each employer's last digest, capped at 7 days) and reminders |
| `job-alerts` | 06:00–11:00 Mondays, hourly | Saved-search alerts, oldest-checked first, resuming where the last run stopped |

The notice windows are state-based rather than "the last 24 hours", and every
message has a dedupe key, so a missed or late run catches up on the next one
without sending anything twice.

**Retries and backoff.** A failed email is retried on the *same* `email_log`
row, at most 5 attempts, with exponential backoff and jitter — roughly 10 min,
40 min, 2 h 40 m, 10 h 40 m — inside a 3-day window. A permanent provider error
(a 4xx other than 408, 425 and 429) gives up at once. Transient database errors
inside a run get a short in-process retry (`withRetry` in
`src/lib/jobs/policy.ts`); anything else fails the run and is recorded.

**Dead letters.** A row that ran out of attempts, hit a permanent error, aged
past the window, or crashed its worker eight times gets `gave_up_at` and stays
`failed`. They are listed at **Admin → Background work**
(`/admin/operations`), with the error. **Retry** there calls `requeue_email`:
one more attempt and a fresh window, picked up by the next sweep — nothing is
sent from the click. A row with nothing left to send by retry time (recipient
opted out, listing gone, superseded) becomes `cancelled`, which is not a
failure.

**Concurrency.** Two runs of the same job cannot overlap: `begin_job_run`
inserts a `running` row under a unique partial index, and a second caller
records `skipped` and exits. A crashed run's lease lapses (`maxDuration` + 30 s)
and the next run closes it as failed. The sweeper leases rows with
`FOR UPDATE SKIP LOCKED` and a lock token, so concurrent sweeps never take the
same row, and every write back is checked against the token.

**Watching it.** `/admin/operations` shows each job's last run, last success,
failures in 7 days and a job that has never run; the outbox's due, in-flight,
waiting and dead counts; and the last 50 runs. `/api/health` adds
`jobs: { "email-retry": true, … }` — fresh means a success within 30 min
(email-retry), 2 h (maintenance), 26 h (expire-jobs, daily-digest) or 8 days
(job-alerts) — and reports `degraded` if any is stale. Logs carry job names,
ids and counts only, never addresses or content.

**Tests.** The SQL is exercised by `pnpm test:db` against the real migrations
in PGlite (`pnpm test:email` runs the outbox suite on its own). The policy,
runner and sweeper modules in `src/lib/jobs/` take their dependencies as
arguments and have no runtime imports, so their tests run under plain
`node --experimental-strip-types` with no database. `pnpm typecheck`,
`pnpm test:messages` and `pnpm test:reads` cover the admin page and its copy.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test:db` | Runs the schema and RLS suites against an in-process Postgres |
| `pnpm db:push:url` | Applies migrations + taxonomies over `DATABASE_URL` (no CLI, no Docker) |
| `pnpm db:seed:demo` | Creates demo accounts via the Auth admin API + sample listings |
| `pnpm doctor` | Preflight: env, REST, schema, storage, auth |
| `pnpm db:rehearse` | Runs the setup scripts against a throwaway wire-protocol Postgres |
| `pnpm db:types` | Regenerates `src/lib/supabase/database.types.ts` from a linked project |

### `pnpm test:db`

`supabase/tests/` boots a real Postgres in-process (PGlite), applies the actual
migrations and seed, and exercises the policies as each kind of user — no Docker,
no project, no network. It covers the rules the product rests on: the
unverified-employer post cap, that publishing is a moderation action, that
verification and credits are granted rather than claimed, that applications are
private to the two parties, the agent-directory gate, and that an employed agent
can stay invisible to their own employer.

Supabase's `auth` and `storage` schemas are stubbed in `tests/setup.mjs`, but
pgcrypto and unaccent are loaded for real, so the `create extension` lines and the
seed's `crypt()`/`gen_salt()` calls are genuinely exercised. Everything below that
line is the production SQL, verbatim.

## Layout

```
src/
  app/[locale]/        every page, ar at / and en at /en
  app/api/             cron, and the signed-URL CV handler
  app/auth/callback    OAuth landing (outside the locale segment on purpose)
  components/          UI, grouped by area
  i18n/                routing, request config, localized() fallback helper
  lib/
    actions/           server actions
    queries/           read paths
    supabase/          browser / server / admin / public clients
messages/              ar.json, en.json — identical key sets
supabase/
  migrations/          enums, tables, indexes, functions, RLS, guards, storage
  seed.sql             taxonomies (production-safe) + a local demo dataset
  tests/               schema and policy suites
```

## Decisions worth knowing

**A missing profile row means "not onboarded."** Nothing auto-creates a profile on
signup. That is what lets `whatsapp_phone` stay `NOT NULL` while still supporting
Google OAuth, where the number is not known until `/onboarding` runs.

**Privilege escalation is blocked by triggers, not policies.** A `WITH CHECK` sees
only the row as it will be, never as it was, so it cannot tell "employer edits
their company" from "employer sets themselves verified." The `guard_*` triggers in
migration 05 compare `OLD` to `NEW`. Their names carry numeric prefixes because
Postgres fires `BEFORE` triggers in name order, and whichever raises first decides
the error the user sees — authorisation (10) speaks before the business rule (20).

**The agent directory reads through a function, not a table.** RLS hides gated rows
outright, which is right for the profile page and useless for a directory that must
show anonymised cards to everyone. `search_agents()` and `get_agent_card()` are
`SECURITY DEFINER` and strip identity themselves, so the gate cannot be bypassed by
crafting a query.

**CVs are never linked directly.** `/api/cv/[applicationId]` checks entitlement
through RLS, mints a five-minute signed URL, and redirects. A URL rendered into the
page would outlive the session and be shareable with anyone.

**`/jobs/[slug]` serves two things.** A job, and a programmatic `<track>-<district>`
landing page. Landing slugs come from a closed taxonomy and every job slug carries a
random suffix, so the two can never collide.

**Expired listings keep their URL.** They render a "this listing has closed" state
and are marked `noindex`, rather than 404-ing every inbound link and search result.

## Known gaps

- **Brand assets live in `public/brand/`.** The palette in `globals.css` is sampled
  from the logo — `#2A4FF6` blue and `#5CE1E6` cyan — and the header mark is that
  logo's glyph, cropped out of the supplied lockup so it can pair with either an
  Arabic or a Latin wordmark.
- **Arabic copy is Egyptian dialect** for instructions, empty states and marketing,
  but the searchable nouns (`وظائف`, `شركات`, track and district names) stay in
  standard form — colloquialising those would cost Arabic search traffic.
- **Prices are the spec's starting hypothesis** and are charged only when
  `BILLING_ENABLED=true`. Before charging anyone, confirm VAT treatment and Egyptian
  Tax Authority e-invoicing obligations with an accountant — which entity issues the
  invoice is a live question.
- **`/privacy` and `/terms` are deliberately empty.** A board that stores CVs and
  phone numbers needs a lawyer, not generated text. The routes exist so the footer
  resolves.
- **Every page renders dynamically**, because the header reads the session. Fine for
  correctness and indexing; if server load becomes a concern, split the auth-dependent
  header into a streamed island and let the rest cache.
- **A 404 body is client-rendered.** The status code and the localized copy are both
  correct, but Next serves its own shell for `notFound()` when the root layout lives
  under a dynamic segment. Fixing it means moving `<html>` to a root layout, which
  costs correct per-locale `lang`/`dir` on every real page — a worse trade for this
  product. Revisit when `global-not-found` is stable.
- **English is translated but unpublished.** `ENGLISH_ENABLED` in
  `src/i18n/routing.ts` is `false`: the locale switcher is hidden, `/en/*`
  temporarily redirects (307) to its Arabic equivalent, hreflang pairs are
  suppressed and the sitemap emits Arabic only. Every English string is still in
  `messages/en.json` — flip the flag to bring the whole side back.
- **Dark mode is built but not switched on.** The full palette exists in
  `globals.css`; nothing sets the `.dark` class yet. Enabling it is a one-line
  change — see the comment above `@custom-variant dark`.
- **The blog has no RSS feed or admin UI.** Posts are Markdown files in
  `content/blog/<slug>.<locale>.md`, statically generated at build time. The two
  seeded articles are drafts for your team to review or replace; they explain
  structures rather than quoting market figures, because I have no data to
  support figures.
- **Paymob is not wired.** Phase 5. `orders` and the pack definitions exist; checkout
  does not.
