# Load, spike and abuse testing

**Never point any of these at production.** Every script refuses a `BASE_URL` whose host is `brokersconnect.net` unless `I_KNOW_THIS_IS_NOT_PRODUCTION=1` is set — and even then, do not.

Target a Vercel preview deployment wired to a Supabase branch (or the staging project) seeded with `pnpm db:seed:demo`. The demo accounts (`candidate1@demo.test`, `employer1@demo.test`, `admin@demo.test`, with the password `pnpm db:seed:demo` printed or the `DEMO_PASSWORD` it was given) are what the authenticated scenarios sign in with; they exist only where the demo seed was run, which is never production.

Requires [k6](https://k6.io) (`brew install k6` / the Docker image).

```
BASE_URL=https://<preview>.vercel.app k6 run load/k6/browse.js       # realistic mixed traffic
BASE_URL=https://<preview>.vercel.app k6 run load/k6/spike.js        # a campaign lands
BASE_URL=https://<preview>.vercel.app SUPABASE_URL=… SUPABASE_ANON_KEY=… k6 run load/k6/authenticated.js
BASE_URL=https://<preview>.vercel.app SUPABASE_URL=… SUPABASE_ANON_KEY=… k6 run load/k6/abuse.js
```

## What each one models

| Script | Models | Passes when |
|---|---|---|
| `browse.js` | 10k MAU ≈ 400 concurrent readers at peak: home, board with filters, job detail, company pages, directory pages, blog, sign-in page. Weighted the way analytics weights them (board and job pages dominate). | p95 < 800 ms, error rate < 0.5 %, no 5xx |
| `spike.js` | A campaign: 20 → 600 virtual users in 30 s on the board and one job, held for two minutes, back down. | p95 < 1.5 s during the spike, error rate < 1 %, and `/api/health` stays 200 (database and pool healthy) |
| `authenticated.js` | Signed-in work: a candidate browsing and opening job pages, an employer opening their applicants and consultant cards, an admin opening the queues. Signs in through Supabase Auth directly (as the browser does) and sends the cookies to the site. | p95 < 1 s, no 403/500 for entitled reads, **no 429 for the honest rates modelled** — a 429 here means a limit is set too low |
| `abuse.js` | Controlled attacks, one at a time, each asserting the defence engaged: (1) directory paging at 20 req/s from one client — expects Vercel Firewall challenge/429 or, without the firewall, the anonymised cards and no contact; (2) contact reveals in a loop as an employer — expects `rate_limited` after the hourly allowance; (3) applications in a loop as a candidate — expects `application_rate_limit` after 8 in 10 min; (4) listing creation in a loop — expects `job_post_rate_limit`; (5) sign-in with a wrong password 20 times — expects Supabase's `over_request_rate_limit` / captcha refusal. | Each attack is refused where the table says it should be, and the honest scenario in `authenticated.js` still passes afterwards |

## Reading the results

- k6 prints p50/p95/p99 per scenario and a checks table; the thresholds in each file are the pass criteria and make the run exit non-zero when missed.
- While a run is on, watch Supabase → Reports (CPU, connections, slow queries) and Vercel → Analytics. The database at 10k MAU is small; the numbers to keep an eye on are pool saturation during `spike.js` and the p95 of the job board with a text search (`?q=`), which is the most expensive public query.
- After `abuse.js`, open `/admin/security` on the preview: every refusal should have appeared as an event.

## What is not modelled

- Uploads (a CV through the browser to Storage) — the storage API is Supabase's, and the interesting part, the server's byte check, is a unit-tested pure function.
- Email — the outbox dedupes and the provider limits; not a load concern at this scale.
