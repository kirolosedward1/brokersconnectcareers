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
   left the card. While billing is off nothing is sold, and the site says only
   that; the policy must be written, and published, first.
4. **Seat tiers.** A pack promises "up to 3 seats" or "up to 15", but credits
   carry no tier: any credit publishes a listing with any number of seats. Either
   enforce the tier when a credit is spent or sell one pack.
5. **The featured add-on** is not for sale (`PACKS_ON_SALE`): paying for it
   would add no credit and pin nothing, because nothing ties the purchase to a
   listing. It needs a purchase that names its listing.
6. Then `BILLING_ENABLED=true` on Vercel and, in the database,
   `update app_settings set credits_required = true;` (migration 066).
