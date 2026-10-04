# The iOS app in App Store Connect

What App Store Connect asks about Brokers Connect, and the answer the code
gives. Each answer names where it comes from, so it can be checked again when
the code changes. The app's own privacy manifest (`mobile/app.config.ts`,
`ios.privacyManifests`) must say the same as the privacy answers below.

Answers marked **decide** are recommendations for the owner, not facts the
code settles.

## App information

| Field | Answer |
| --- | --- |
| Name | Brokers Connect (Arabic: بروكرز كونكت — `mobile/assets/locales/ar.json`) |
| Bundle ID | `net.brokersconnect.app` — permanent once submitted |
| Primary language | Arabic (the app is right to left, Arabic only while the website's `ENGLISH_ENABLED` is off) |
| Category | **decide** — Business (job boards and professional directories sit there); `mobile/store.config.js` says Business |
| Privacy policy URL | `https://www.brokersconnect.net/privacy` (`content/legal/privacy.ar.md`; the English text is at `/privacy?lang=en`). It, the terms, the cookie page and the account-deletion page want the owner's legal review (`docs/legal.md`) |
| Account deletion URL | `https://www.brokersconnect.net/account-deletion` — the web page an app store asks for (Google Play requires one): how to delete in the app and on the website, what goes and what stays, and how to ask without signing in |
| Support URL | the website, or a page with `SUPPORT_EMAIL` on it (the footer and the app's "Contact us" fall back to the operator's published address, `src/lib/business.ts`) |
| Price | Free. The app sells nothing (`/employer/billing` is read-only; see Guideline 3.1.1 below) |

## The listing, as code

`mobile/store.config.js` is the listing App Store Connect shows, in Arabic
(the primary language, `eas.json` → `submit.production.ios.language`) and
English: name, subtitle, description, keywords, promotional text, the support,
marketing, privacy and privacy-choices links, the category, the copyright, the
age-rating answers below and the release (by hand, once approved). EAS Metadata
reads it (`metadataPath` in `eas.json`); from `mobile/`:

- `npx eas-cli@latest metadata:lint` checks it against Apple's limits without
  signing in (`tests/store-config.test.ts` checks the same limits, the links
  and the claims with every app check);
- `npx eas-cli@latest metadata:push` writes it to App Store Connect, after the
  first build has created the app's record there.

Its words make claims the code backs: a listing goes live only after
moderation, every listing names who supplies the leads, candidates pay nothing,
and the app is in Arabic while `ENGLISH_ENABLED` is off. Change the file when
one of those changes; the test fails on the last.

The reviewer's contact and the two review accounts are not in the file — the
repository is public. The push that sends them reads eight variables from its
environment, all or none (some but not all stops the push):

```bash
export APP_REVIEW_CONTACT_FIRST_NAME=… APP_REVIEW_CONTACT_LAST_NAME=…
export APP_REVIEW_CONTACT_EMAIL=… APP_REVIEW_CONTACT_PHONE='+20 …'
export APP_REVIEW_CANDIDATE_EMAIL=… APP_REVIEW_CANDIDATE_PASSWORD=…
export APP_REVIEW_EMPLOYER_EMAIL=… APP_REVIEW_EMPLOYER_PASSWORD=…
npx eas-cli@latest metadata:push
```

The candidate is the sign-in App Review uses; the employer goes into the
review notes, which the file writes (`reviewNotes`). Without the variables, a
push leaves the review details App Store Connect already has.

An App Store name is unique across the store: if «Brokers Connect» or
«بروكرز كونكت» is taken, App Store Connect refuses it, and the name in
`store.config.js` (and `appName` in `eas.json`, for the first submission)
changes to one that is free.

## Screenshots

`.github/workflows/ios-screens.yml` (Actions → iOS screens → Run workflow)
builds the app as the App Store gets it — Release, the JavaScript bundled in
— and runs it on iOS simulators in Arabic against the live site
(`mobile/scripts/store-screens.sh`, the screens in `mobile/maestro/`). Each
screen is opened by a link, checked for the app's error, offline, unavailable,
not-found and update-required states, and captured. The light and large-text
passes then go, as a person would, through what someone signed out meets first
— Account, the sign-in sheet, the forgotten-password page and sign-up
(`mobile/maestro/signed-out.yaml`) — checked the same way, not captured. A
crash, an error screen or a screen that never loads fails the run.
`mobile/tests/maestro-flows.test.ts` holds every phrase the flows wait for to
the catalogue, so a reworded string fails the app's check rather than this
run. Its artifact, `ios-screens`, holds:

- `store/1-home.png` … `5-company.png`: Home, the board, a listing, the
  companies and a company page on the largest iPhone, the 6.9-inch
  screenshots App Store Connect asks for (the log prints their sizes);
- `dark/`, `large-text/` and `ipad/`: the same screens in the dark appearance,
  at the largest accessibility text size and on an iPad (App Review opens an
  iPhone app on one too), for checking rather than for the store.

On the iPad, iPadOS 26 draws an iPhone app in a window of its own, and Maestro
loses that window after the first link: it read none of the app's words while
the screen showed them. That pass therefore checks each screen by what macOS's
text recognition reads on it (`mobile/scripts/screen-text.swift`), for the
same words and error states as the iPhone passes.

They show whatever the live site lists when the workflow runs — its first
listing and its first company — so run it when production holds the listings
the store should show. Where it lists none, the board or the company list is
checked empty, the page it would lead to is left out, and the run says so: a
smoke run, not the store's screenshots. (Once this code is deployed, the
company list shows only companies with a live listing.) They go into App Store
Connect by hand (the 6.9-inch slot of each language).

## App privacy ("nutrition label")

**Tracking: no.** No advertising or analytics SDK, no data shared with data
brokers, no cross-app tracking; the manifest says `NSPrivacyTracking: false`.
The app sends no crash reports or usage analytics of its own.

Every type below is **linked to the person's identity** and used **only for
app functionality** (running the account and the marketplace). None is used
for tracking, advertising, or third-party marketing.

| App Store category | Type | What it is in this product |
| --- | --- | --- |
| Contact info | Name | the account's full name |
| Contact info | Email address | the sign-in address (Supabase Auth) |
| Contact info | Phone number | the WhatsApp number on the profile, shown to employers under the product's rules |
| User content | Photos or videos | the profile photo and the company logo (`uploadImage`) |
| User content | Other user content | CVs, company verification documents, applications and their notes, reports |
| User content | Customer support | help and account-deletion requests (`support_requests`) |
| Search history | Search history | saved searches and followed companies |
| Identifiers | User ID | the account id |
| Identifiers | Device ID | the push token registered for the phone (`push_devices`); the random install id `expo-updates` sends to Expo with each update check (not linked to the account) |
| Other data | Other data types | work history, education, certifications and the sales record on a consultant's profile; the record of which versions of the Terms and the Privacy policy the person agreed to, and when (`policy_acceptances`) |
| Usage data | Product interaction | a company opening a consultant's profile (`agent_profile_views`, kept 60 days, shown to the consultant as a count) and asking for a consultant's number or CV (`agent_contact_reveals`, used for the daily limits) |

Not collected: location, contacts, browsing history, purchases, financial
info, health, sensitive info, diagnostics. No analytics or advertising SDK is
in the app, and nothing is used to track people across apps or websites.

## Guidelines that apply, and how the app meets them

- **5.1.1(v) account deletion.** Account → Delete account, with the word typed
  out (`deleteMyAccount`). An account made with Sign in with Apple is asked for
  a fresh Apple authorization code first, and the website revokes the grant
  (`src/lib/apple/revoke.ts`). A company owner, whose account cannot be
  deleted at a tap without taking the company and other people's applications
  with it, asks for it from the same screen (`requestAccountDeletion`) and is
  told how long it takes: a reply within 7 days, deletion within 30 (**decide**:
  these are the words in `messages/*.json`, `account.deleteRequested`). An
  account that never finished onboarding is deleted from the onboarding screen
  itself (**Delete this account**, under signing out), without agreeing to the
  Terms first.
- **4.8 Sign in with Apple.** Offered wherever Google is (`enabledProviders()`
  shows both once the Apple provider is on in Supabase). On an iPhone the app
  shows Google only beside Apple (`mobile/src/components/auth/social-sign-in.tsx`),
  so a build submitted before Apple is on offers neither rather than Google
  alone.
- **1.2 user-generated content.** Listings, companies and consultant profiles
  can be reported (`reportTarget`), a company or a consultant can be hidden on
  the phone (the block: `hidden-companies.ts`, `hidden-agents.ts`) and
  brought back from Account → "Hidden on this phone", the
  Terms and the Privacy policy are agreed to at onboarding — an unticked box,
  with the person confirming they are 18 or older, recorded with the versions
  agreed to (`policy_acceptances`, migration 336) — and reports reach the
  moderation console on the website.
- **3.1.1 payments.** Nothing is sold in the app; billing shows credits and
  orders read-only, and the website's checkout is off.
- **Export compliance.** `ITSAppUsesNonExemptEncryption` is false
  (`usesNonExemptEncryption: false`): the app's encryption is the system's —
  HTTPS, and the stored session sealed with AES-GCM through Apple's own
  CryptoKit (`expo-crypto`, `mobile/src/lib/session-storage.ts`) — which is
  exempt.
- **Permissions**, each asked when it is used, with Arabic and English
  purpose strings: the photo library and camera (profile photo, logo, company
  papers) and notifications (the prompt on Home, never at launch).

## Age rating

**18+.** The Terms and the Privacy policy limit the service to people aged 18
and over, and onboarding asks for that confirmation, so the store listing must
not offer the app to children: choose the 18+ age rating (in App Store
Connect's age-rating questionnaire, set the minimum age to 18 / the "18+"
rating where offered, rather than the 4+ the content questions alone would give).
The content answers: no violence, sexual content, gambling, drugs or medical
content; user-generated content exists and is moderated; the in-app browser
opens the pages the app names — the website's, a licence's text, the
captcha's own links — and has no address bar ("unrestricted web access": no).

## Review accounts

App Review signs in, so it needs accounts that show the whole app — never the
seeded demo accounts, which must be deleted (`docs/privacy/AUDIT-2026-09-27.md`).
`pnpm review-accounts` (`scripts/review-accounts.mjs`) makes them on the
project it is pointed at, once that project's migrations are applied:

- a **candidate** with a directory profile — hidden from the directory, so no
  real company finds it — and a CV, who has applied to
- the first of two live listings of a **verified company** whose owner, the
  **employer**, is approved. The second has no applications: it is the one the
  reviewer applies to from the candidate account (a listing takes one
  application per person).

Both have agreed to the current Terms and Privacy policy, as onboarding records
it. Each is labelled as the review's wherever it shows: the company is «حساب
مراجعة التطبيق», and each listing says it is not a real job. They are on the
public board while they are live, like every listing, so make the accounts just before
submitting and take them away once the app is approved:

```bash
# As for pnpm db:apply: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# TARGET_DATABASE_URL (the same project). Then two inboxes you read:
export REVIEW_CANDIDATE_EMAIL=… REVIEW_EMPLOYER_EMAIL=…
pnpm review-accounts                                                    # what it would do
pnpm review-accounts --execute --confirm hiwdhicwsohbipxzazmb           # makes them
pnpm review-accounts --remove --execute --confirm hiwdhicwsohbipxzazmb  # after approval
```

Making them prints the `APP_REVIEW_*` lines `metadata:push` needs ("The
listing, as code"); the passwords are kept nowhere else, and running it again
sets new ones. Each run also starts the review over, so run it before every
submission: what the last review left — its application to the second
listing, the applicant moved on, a listing edited back into review or past its
thirty days, the profile shown in the directory, the bells — goes, and
everything is as the first run made it. Both profiles show the operator's number (`src/lib/business.ts`)
unless `REVIEW_PHONE` names another, so a reviewer who taps WhatsApp reaches
you, not a stranger. Removing deletes the listings with every application to them
— someone who applied despite what it says loses that application — then the
company, the CV and both users. `supabase/review-accounts.sql` is what it
writes, tested on the real migrations (`pnpm test:review-accounts`).

The candidate is the sign-in App Review is given; the notes, written by
`mobile/store.config.js` (`reviewNotes`), carry the employer account and say
where each part of the app is, that a new listing waits for moderation, how
account deletion works for a company owner, and that nothing is sold in the
app. "The listing, as code" above says how they reach App Store Connect.

## Before the first submission (the owner)

In this order; each needs an account, a secret or a decision only the owner
has.

**Before any of it: real listings on production.** On 2026-10-02 none was
live, and every listing production had was the demo data's (14 expired, 3
waiting for review, 1 draft); the one real company had posted none. So the
app's board and company list were both empty, and stay empty once the demo data
goes (step 0) until companies post. App Review is likely to turn down an app
that opens empty, and the screenshots need real listings: get companies
posting, and approve their listings in the console (`/admin`), before
submitting.

0. **The seeded demo data off production** (P0.1 in
   `docs/privacy/AUDIT-2026-09-27.md`): `pnpm remove-demo` lists what it would
   remove — on 2026-10-02, 15 accounts, 7 companies, 18 listings and the 33
   applications to them, one of them from a real account — and
   `pnpm remove-demo --execute --confirm hiwdhicwsohbipxzazmb` removes it, with
   the same variables as `pnpm db:apply`. Deleting the users in the dashboard
   fails for the employers: a profile that owns a company is never deleted
   from under it. App Review gets its own two accounts ("Review accounts"),
   never these.
1. **The website's server keys on Vercel** (production), then a redeploy.
   `SUPABASE_SERVICE_ROLE_KEY` first: without it account deletion answers
   "unavailable", CV and document links do not open, team invites, view
   counts, the crons, emails and pushes do nothing — in the app and on the
   website alike. Then `RESEND_API_KEY` and `RESEND_FROM` (emails),
   `CRON_SECRET`, `SECURITY_SALT`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` with
   `TURNSTILE_SECRET_KEY` if Supabase Auth asks for a CAPTCHA, and the app's
   own (`docs/mobile.md`, Configuration): `APPLE_APP_ID`, the four `APPLE_*`
   revocation values, `EXPO_ACCESS_TOKEN` if enhanced push security is on.
   All are set in Vercel → the project → Settings → Environment Variables,
   for Production.
2. **The two Vault secrets** for the push sweep, by hand in the SQL editor
   (`docs/mobile.md`, Pushes). And, if not done yet, **the five auth email
   templates** pasted into Supabase (Authentication → Emails → Templates, from
   `supabase/templates/`; `docs/email.md`, step 4). Their links go to
   `/auth/confirm`, which the app opens. Supabase's defaults end in the
   browser's code flow, which only the browser that asked can finish: a
   password reset asked for in the app could never be completed, and a sign-up
   link lands on the website's sign-in page saying the link failed.
3. **Merge the app's pull request** into `main` (Vercel deploys it), then
   apply the migrations still pending, from your computer:
   `pnpm db:apply --execute --confirm hiwdhicwsohbipxzazmb` with
   `TARGET_DATABASE_URL` set to the session pooler. The dry run (without
   `--execute`) lists them first. 331 was applied on 2026-09-30, so it lists
   332 and anything newer.
4. **Apple and Expo:** Apple Developer Program membership (an organisation
   needs a D-U-N-S number) and an Expo account; `npx eas-cli@latest init`, and
   the project id it prints written into `mobile/app.config.ts`
   (docs/mobile.md, Releasing); an APNs key uploaded with
   `npx eas-cli@latest credentials`; the Sign in with Apple key and Services
   ID, and the Apple provider on in Supabase (docs/mobile.md, Configuration).
   The build then carries over-the-air updates: later fixes go out with
   `pnpm run ota production --message "…"` in `mobile/`, without a review
   (docs/mobile.md, Over-the-air updates).
5. **The app icon, if you want it redrawn.** The one in the build
   (`mobile/assets/images/icon.png`, the mark on white) is 1024 pixels and
   opaque, as the store requires, and is enough to submit. A vector logo from a
   designer would let it and the splash be drawn crisper.
6. **The legal pages reviewed by a lawyer** (`docs/legal.md`, "The
   documents"), and the two review accounts ("Review accounts" above).
7. **A development build on a real iPhone** against production, through the
   checklist in `docs/mobile.md` ("On a phone, before a release"), with QA
   accounts — never the demo ones.
8. **Screenshots**: run the iOS screens workflow once production holds real
   listings, and upload its `store` set ("Screenshots" above).
9. **The App Store build**, from `mobile/` on your computer:
   `npx eas-cli@latest build --platform ios --profile production --auto-submit`.
   EAS builds it with Xcode 26, which SDK 57 needs, signs it with the
   credentials it keeps, and uploads it to App Store Connect. The first upload
   creates the app's record there and asks you to sign in with your Apple ID.
   After Apple's processing it is in TestFlight: install it on the iPhone
   from there. Then `npx eas-cli@latest metadata:push`, with the review
   variables set ("The listing, as code"), fills in the listing, and it is
   submitted for review from App Store Connect.
10. After the listing exists: `MOBILE_APP_STORE_URL` on Vercel, so the
   "update the app" screen can link to it, and `MOBILE_MIN_APP_VERSION` raised
   only when an older build must stop.

### Android, when it ships

- Firebase: a project with the Android app `net.brokersconnect.app`; its
  `google-services.json` as an EAS file variable `GOOGLE_SERVICES_JSON` (not
  committed — the repository is public), and its FCM V1 service-account key
  uploaded with `npx eas-cli@latest credentials`. Until both, the Android app
  does not offer pushes.
- `ANDROID_CERT_SHA256` on Vercel — the signing certificate's fingerprint, from
  `eas credentials` or the Play Console — so links to the site open the app.
- After the listing exists: `MOBILE_PLAY_STORE_URL`, and
  `MOBILE_MIN_ANDROID_APP_VERSION` when an Android build must stop.
