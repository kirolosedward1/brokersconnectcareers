# Edge protection — Vercel Firewall

`www.brokersconnect.net` resolves directly to Vercel (216.150.x.x); there is no Cloudflare zone in front of it. The edge layer is therefore **Vercel's Firewall** (WAF + rate limiting + bot management), configured on the project, not in this repository. This document is the configuration, written so it can be applied by hand in the dashboard or by `scripts/vercel-firewall.mjs` with a token that has project access (the token available during this round did not).

Principles, from the brief: search engines are never blocked; ordinary page views never meet a challenge; sensitive endpoints are limited more aggressively than content; every rule is measured against real traffic before it moves from *log* to *deny*.

## 1. Managed protections (Project → Firewall → Managed rules)

| Ruleset | Action |
|---|---|
| OWASP Core Rule Set (Vercel managed) | **Log** for one week, then **Deny** for the SQLi / XSS / RCE / LFI groups; leave the generic-attack group on Log if it flags Arabic query strings |
| Bot Protection | On, **Challenge** unverified bots on `/agents*`, `/api/*` and `/sign-*`; **allow** verified bots (Googlebot, Bingbot) everywhere |
| AI bots | Deny on `/agents*` |
| Attack Challenge Mode | Off by default; the on-call person turns it on during a volumetric attack (it challenges every visitor for the duration) |

## 2. Rate-limit rules (Custom rules → Rate limit)

Keyed on IP unless stated. Windows are fixed. `Challenge` shows a Vercel interstitial once and sets a cookie; `Deny` returns 429.

| # | Name | Match | Limit | Action | Why this number |
|---|---|---|---|---|---|
| 1 | auth pages | path starts with `/sign-in`, `/sign-up` or `/onboarding` | 60 req / 1 min | Challenge | A person reloads a sign-in page a handful of times; a script posts to it hundreds. The auth calls themselves go to Supabase, so this only slows page fetches — it is here to stop the page being used as a beacon. |
| 2 | directory pages | path starts with `/agents` | 120 req / 1 min, then 600 / 10 min | Challenge, then Deny | 24 cards a page; a recruiter reading the whole directory in an hour is ~40 requests. A scraper paging every filter is thousands. |
| 3 | job pages | path starts with `/jobs` | 300 req / 1 min | Challenge | Listings are public content and SEO matters; this catches only bulk copying. |
| 4 | CV and export routes | path starts with `/api/cv/`, `/api/agent-cv/` or `/api/account/export` | 30 req / 1 min | Deny | The application enforces 60/hour per account; this catches many accounts from one address. |
| 5 | unsubscribe | path starts with `/api/unsubscribe` | 20 req / 1 min | Deny | Tokens are unguessable UUIDs; this bounds a probe anyway. |
| 6 | webhooks | path starts with `/api/email/webhook` or `/api/paymob/webhook` | 120 req / 1 min | Deny | Both verify signatures; this bounds the CPU spent verifying garbage. |
| 7 | server actions | method POST and header `next-action` present | 90 req / 1 min | Challenge | Every form on the site. Filling a form ninety times a minute is not a person. |
| 8 | health | path is `/api/health` | 30 req / 1 min | Deny | It makes a real database round trip. |

## 3. Custom rules (Custom rules → Conditions)

| Name | Condition | Action |
|---|---|---|
| block empty-UA on API | path starts with `/api/` AND user-agent is empty | Deny |
| geo review | country not in (EG, AE, SA, KW, QA, BH, OM, JO, GB, US, DE, FR, CA) AND path starts with `/sign-up` | Challenge — the audience is the Egyptian market; this is a challenge, not a block, so nobody legitimate is locked out |
| no cache on private | path starts with `/api/cv/` | Deny if request has `cache-control: only-if-cached` (defensive; the route sets no-store anyway) |

## 4. What not to do

- Do not put a challenge on `/`, `/jobs*` (below rule 3's rate) or `/companies*`. That is the SEO surface.
- Do not deny by ASN for mobile carriers: Egyptian mobile traffic is heavily NATed, and one address can be a whole neighbourhood. Every rule above challenges before it denies for that reason.
- Do not rely on the edge for anything the database already enforces. The edge sees the site; a signed-in script can reach PostgREST without it. The edge exists to make the site-shaped attacks (page scraping, form flooding, credential-stuffing page loads) expensive.

## 5. Applying it

```
VERCEL_TOKEN=… VERCEL_TEAM_ID=team_… VERCEL_PROJECT_ID=prj_… node scripts/vercel-firewall.mjs --dry-run
VERCEL_TOKEN=… VERCEL_TEAM_ID=team_… VERCEL_PROJECT_ID=prj_… node scripts/vercel-firewall.mjs
```

The script reads `docs/security/vercel-firewall.json`, shows the diff against the active configuration, and applies it with the Firewall API (`PUT /v1/security/firewall/config`). Managed rulesets and Bot Protection are plan features toggled in the dashboard; the script covers the rate-limit and custom rules.

## 6. Watching it

Project → Firewall → Overview shows matches per rule. After the first week: any rule with zero matches is either wrong or unnecessary; any rule matching known-good traffic (the Search Console crawl, the team's own office) needs its threshold raised, not an allow-list entry.
