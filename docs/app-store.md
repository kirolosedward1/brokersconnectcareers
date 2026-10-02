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
| Category | **decide** — Business (job boards and professional directories sit there) |
| Privacy policy URL | `https://www.brokersconnect.net/privacy` (`content/legal/privacy.ar.md`; the English text is at `/privacy?lang=en`). It, the terms, the cookie page and the account-deletion page want the owner's legal review (`docs/legal.md`) |
| Account deletion URL | `https://www.brokersconnect.net/account-deletion` — the web page an app store asks for (Google Play requires one): how to delete in the app and on the website, what goes and what stays, and how to ask without signing in |
| Support URL | the website, or a page with `SUPPORT_EMAIL` on it (the footer and the app's "Contact us" fall back to the operator's published address, `src/lib/business.ts`) |
| Price | Free. The app sells nothing (`/employer/billing` is read-only; see Guideline 3.1.1 below) |

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
  shows both once the Apple provider is on in Supabase).
- **1.2 user-generated content.** Listings, companies and consultant profiles
  can be reported (`reportTarget`), a company can be hidden on the phone, the
  Terms and the Privacy policy are agreed to at onboarding — an unticked box,
  with the person confirming they are 18 or older, recorded with the versions
  agreed to (`policy_acceptances`, migration 336) — and reports reach the
  moderation console on the website.
- **3.1.1 payments.** Nothing is sold in the app; billing shows credits and
  orders read-only, and the website's checkout is off.
- **Export compliance.** `ITSAppUsesNonExemptEncryption` is false
  (`usesNonExemptEncryption: false`): the app uses only the system's HTTPS.
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
opens the website's own pages ("unrestricted web access": no).

## Review notes (template)

App Review needs accounts that show the whole app. Create them on production
(never the seeded demo accounts, which must be rotated — see
`docs/privacy/AUDIT-2026-09-27.md`):

1. A **candidate** with a completed directory profile and a CV.
2. An **approved employer** whose company is **verified**, with one live
   listing that the candidate above has applied to.

Then, in the notes:

> Brokers Connect is an Arabic-language job board and consultant directory for
> Egypt's real estate market. Candidate account: <email> / <password> — browse
> Jobs, open a listing, apply; Applications, Saved and the directory profile
> are in the tabs and under Account. Employer account: <email> / <password> —
> Listings (post and edit a role), Applicants (move an applicant, open a CV),
> Consultants (the directory, contact reveal, shortlist). Account → Delete
> account deletes the signed-in account; for a company owner it files a
> deletion request, because deleting the account would delete other people's
> applications. Nothing is sold in the app.

## Before the first submission (the owner)

In this order; each needs an account, a secret or a decision only the owner
has.

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
   (`docs/mobile.md`, Pushes).
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
5. **A 1024-pixel app icon** (only a 450-pixel mark exists today) and the
   splash image.
6. **The legal pages reviewed by a lawyer** (`docs/legal.md`, "The
   documents"), and the two review accounts above.
7. **A development build on a real iPhone** against production, through the
   checklist in `docs/mobile.md` ("On a phone, before a release"), with QA
   accounts — never the demo ones.
8. Screenshots for the required iPhone sizes, in Arabic.
9. After the listing exists: `MOBILE_APP_STORE_URL` on Vercel, so the
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
