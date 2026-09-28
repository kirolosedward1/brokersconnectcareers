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
| Privacy policy URL | `https://www.brokersconnect.net/privacy` — it must have real content before submission |
| Support URL | the website, or a page with `SUPPORT_EMAIL` on it |
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
| Identifiers | Device ID | the push token registered for the phone (`push_devices`) |
| Other data | Other data types | work history, education, certifications and the sales record on a consultant's profile |

Not collected: location, contacts, browsing history, purchases, financial
info, health, sensitive info, diagnostics, usage data.

## Guidelines that apply, and how the app meets them

- **5.1.1(v) account deletion.** Account → Delete account, with the word typed
  out (`deleteMyAccount`). An account made with Sign in with Apple is asked for
  a fresh Apple authorization code first, and the website revokes the grant
  (`src/lib/apple/revoke.ts`). A company owner, whose account cannot be
  deleted at a tap without taking the company and other people's applications
  with it, asks for it from the same screen (`requestAccountDeletion`) and is
  told how long it takes: a reply within 7 days, deletion within 30 (**decide**:
  these are the words in `messages/*.json`, `account.deleteRequested`).
- **4.8 Sign in with Apple.** Offered wherever Google is (`enabledProviders()`
  shows both once the Apple provider is on in Supabase).
- **1.2 user-generated content.** Listings, companies and consultant profiles
  can be reported (`reportTarget`), a company can be hidden on the phone, the
  Terms are agreed to at sign-up, and reports reach the moderation console on
  the website.
- **3.1.1 payments.** Nothing is sold in the app; billing shows credits and
  orders read-only, and the website's checkout is off.
- **Export compliance.** `ITSAppUsesNonExemptEncryption` is false
  (`usesNonExemptEncryption: false`): the app uses only the system's HTTPS.
- **Permissions**, each asked when it is used, with Arabic and English
  purpose strings: the photo library and camera (profile photo, logo, company
  papers) and notifications (the prompt on Home, never at launch).

## Age rating

**decide** — the questionnaire's answers the code suggests: no violence,
sexual content, gambling, drugs or medical content; user-generated content
exists and is moderated; the in-app browser opens the website's own pages.
That usually comes to 4+; answer "unrestricted web access" as no.

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

- Apple Developer Program membership (an organisation needs a D-U-N-S
  number) and an Expo account; `npx eas-cli@latest init`, and `EAS_PROJECT_ID`
  set for builds.
- An APNs key uploaded with `npx eas-cli@latest credentials`.
- The Sign in with Apple key and Services ID, and the Apple provider on in
  Supabase (docs/mobile.md, Configuration).
- A 1024-pixel app icon (only a 450-pixel mark exists today).
- Real Privacy Policy and Terms pages on the website.
- The two review accounts above.
- Screenshots for the required iPhone sizes, in Arabic.
- After the listing exists: `MOBILE_APP_STORE_URL` on Vercel, so the
  "update the app" screen can link to it, and `MOBILE_MIN_APP_VERSION` raised
  only when an older build must stop.
