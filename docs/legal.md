# What the site promises, and what keeps each promise true

The legal pages (`content/legal/*.md`, rendered by `src/lib/legal.ts`) and the
marketing copy (`messages/{ar,en}.json`) make statements about the product. A
statement the code does not back is a misleading claim under Egypt's Consumer
Protection Law (181/2018) and the advertising rules of every market the site
reaches, whatever the intent behind it. This file lists each one beside the
code that makes it true, so a change to either side shows up as a change to
the other.

The texts themselves are not legal advice and have not been reviewed by a
lawyer. That review is the owner's to arrange before launch.

## The documents

Five documents, each a page with an Arabic text (which prevails) and an English
one at `?lang=en` (served whether or not English is switched on for the site):

| Page | File | What it is for |
|---|---|---|
| `/privacy` | `content/legal/privacy.{ar,en}.md` | What is kept, why, who sees it, for how long, where, and a person's rights |
| `/terms` | `content/legal/terms.{ar,en}.md` | The agreement: who may use the site, what companies and consultants owe each other, moderation, liability |
| `/cookies` | `content/legal/cookies.{ar,en}.md` | Everything the website keeps in a browser and the app on a phone, and why no consent banner |
| `/refunds` | `content/legal/refunds.{ar,en}.md` | Nothing is sold; what happens before anything is |
| `/account-deletion` | `content/legal/account-deletion.{ar,en}.md` | How to delete an account, what goes and what stays — the page an app store asks for |
| `/licenses` | generated (`scripts/licenses.mjs`) | The open-source notices for the website and the app |

All of them are linked from the footer of every page, and the privacy policy,
the terms and the licences from the app's Account tab, signed in or not.

**Agreeing.** A person agrees to the terms and the privacy policy, and confirms
they are 18 or older, with the checkbox at onboarding — the one step every way
in (email, Google, Apple; website or app) goes through — and the sign-up screens
point at both documents before an address is typed. The versions agreed to are
the documents' `updated:` dates, written in `src/lib/policy-versions.ts` and
recorded in `policy_acceptances` (migration 336). **Changing either date asks
everybody to agree again**, through a notice on every page and in the app; so
change it for a change people should be asked about, and change it in both the
document and `policy-versions.ts` (`pnpm test:legal` fails until they match).

**Who runs the site** — Top Suite Digital Marketing, Dubai, its email and phone
— is in `src/lib/business.ts`, shown under every page's footer and in the app,
and held to the documents by `pnpm test:legal`. A street address and a
commercial registration number belong there too, once the owner supplies them.

**No cookie banner, on purpose.** The website keeps exactly three things in a
browser: the sign-in session (Supabase's `sb-…-auth-token` cookies, and the
PKCE verifier while a sign-in is under way), the light/dark choice someone made
(`bc-theme`, only when they make one), and — only while visit counting is on —
which share link a visit came from (`bc.src`, for the tab's lifetime). The first
is strictly necessary for a service the person asked for, the second remembers
a choice they made, and the third is cookieless counting that identifies nobody
(Plausible or Umami). None needs consent under the ePrivacy rules a banner
exists for, and Egypt's data protection law has no cookie rule of its own.
`localeCookie: false` removed the one cookie that had no purpose. Adding any
advertising, cross-site or identifying analytics would change this — and
`pnpm test:legal` fails when anything new writes to a browser until the cookie
page lists it.

**Files at request time.** The pages read their markdown when they are
rendered, and Vercel ships a function only with files Next saw it read. Next
cannot see `${slug}.${locale}.md`, so `next.config.ts` names every document in
`outputFileTracingIncludes`; `pnpm test:legal` holds that list to
`LEGAL_SLUGS`, and the policy versions are a constant for the same reason.

## Listings

| The site says | What makes it true |
|---|---|
| Every listing says who supplies the leads | `jobs.leads_source` is `not null` (migration 001) and required by the form (`src/lib/actions/employer-jobs.ts`) |
| The salary and the commission are shown in figures *when the company publishes them* | Both are optional. No salary figures is shown as "commission only" (the form says to leave it empty for a commission-only role), or "no basic salary" when the listing also says there is no commission (`SalaryLine`, the app's `useCompensationText`, the job page's search preview). The commission can be "undisclosed" (`commission_type`) |
| "We ask every company for the salary and the commission" | The form has the fields; it does not require them. Never write "every listing states the salary" |
| Listings close on their own 30 days after going live | `stamp_job_publication` sets `expires_at = published_at + 30 days` (migrations 003, 046); the nightly job closes them |
| Listings are reviewed before they go live | Only a moderator's approval moves a listing to `active` |
| Sponsored listings are labelled, and come first | `is_featured`, set by a paid add-on or the admin lever (`admin_set_job_featured`, migration 318) for 14 days. Every card says "Sponsored" (`jobs.featured`); the board says sponsored listings come first whenever one is on the page (`jobs.sponsoredFirst`); the signed-in home's heading says "Sponsored listings". Alerts (the weekly email, the daily bell) do not pin them: `queryJobs(…, { pinSponsored: false })` |
| "Verified" means our team checked the company's details | An admin's decision, from the uploaded papers or — with a recorded reason — another check (`admin.verifyWithoutPapers`). So the badge never claims "uploaded its commercial register" |
| Unverified companies keep one live listing | `enforce_active_post_cap` (migration 046) |
| The consultant directory is for companies only | `can_browse_agent_directory()` (migration 322): approved employers and admins |
| "N consultants in the directory" (/employers) | Counted by the directory's own rule: not hidden, owned by an approved candidate (`employers/page.tsx`) |
| No fees for candidates | Nothing a candidate does is charged; billing only sells packs to companies |

Removed on 2026-10-01 because nothing backed them: "Egypt's best real estate
jobs platform", "every listing states the basic salary and the commission",
"if it is on the board it is genuinely open", "employers reach you on
WhatsApp", "fewer people walk after the first interview", "usually within one
working day", "applying is free and always will be", an open-seats figure that
added up the first page of the board, and a social card repeating the salary
claim (`public/brand/og.jpg`, regenerated with `scripts/og-card.mjs`).

## Before visit counting is switched on

`NEXT_PUBLIC_ANALYTICS_PROVIDER` is unset everywhere, so no analytics script
loads. The cookie page says that, if it is switched on, the provider receives
the address of each page viewed. Two kinds of address must not reach it, so
configure these first:

1. **Paths that name a person** — `/agents/<slug>` (a consultant's name,
   transliterated) — and the signed-in areas (`/dashboard`, `/employer`,
   `/admin`, `/notifications`, `/onboarding`). Plausible: load the
   `script.exclusions.tagged-events.js` variant with `data-exclude`; Umami: a
   `data-before-send` function that drops them.
2. **Query strings that carry a token** — `/unsubscribe?token=…`. Plausible
   records paths without the query; Umami needs `data-exclude-search="true"`.
3. **`NEXT_PUBLIC_ANALYTICS_SRC` as well as the provider.** The content
   security policy allows the analytics script only from that variable's
   origin (`next.config.ts`), so with the provider set and no source the
   default script is blocked and nothing is counted.

## Before billing opens

`BILLING_ENABLED` is off: posting is free, and the site says so and shows no
prices. Turning it on is the owner's decision, and these come first:

1. **Prices.** `POST_PACKS` in `src/lib/taxonomy.ts` are a hypothesis from the
   original spec, not decided prices.
2. **VAT.** Whether prices include it, and the company's tax registration, on
   the pricing grid and on every receipt; and whether Egypt's e-invoicing and
   e-receipt rules apply to these sales.
3. **A refund policy.** What happens to unused credits, a listing rejected
   after a credit was spent (today nothing is charged on rejection: a credit is
   spent on approval, migration 066), and a payment that failed after money
   left the card. While billing is off nothing is sold, and `/refunds` says
   only that — and promises the terms will be published before anything can be
   bought. Rewrite `content/legal/refunds.{ar,en}.md` first.
4. **Seat tiers.** A pack promises "up to 3 seats" or "up to 15", but credits
   carry no tier: any credit publishes a listing with any number of seats. Either
   enforce the tier when a credit is spent or sell one pack.
5. **The featured add-on** is not for sale (`PACKS_ON_SALE`): paying for it
   would add no credit and pin nothing, because nothing ties the purchase to a
   listing. It needs a purchase that names its listing.
6. Then `BILLING_ENABLED=true` on Vercel and, in the database,
   `update app_settings set credits_required = true;` (migration 066).
