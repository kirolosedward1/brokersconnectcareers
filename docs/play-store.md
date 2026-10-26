# The Android app on Google Play

What the Play Console asks about Brokers Connect, and the answer the code
gives — the Android counterpart of `docs/app-store.md`, which it follows and
does not repeat: the privacy answers, the review accounts and the guidelines
are the same product facts, asked in Google's words.

Android has not shipped yet. Everything here is ready for the day it does; the
steps only the owner can take are at the end. Answers marked **decide** are
recommendations for the owner, not facts the code settles.

## App identity

| Field | Answer |
| --- | --- |
| Package name | `net.brokersconnect.app` (`mobile/app.config.ts`) — permanent once the first build is uploaded |
| App name | بروكرز كونكت (Arabic, default) · Brokers Connect (English) |
| Default language | Arabic (`ar`) |
| App or game | App |
| Free or paid | Free. Nothing is sold in the app |
| Category | Business (**decide**, as on the App Store) |
| Contact email | `info@topsuite.net`, the operator's published address (`src/lib/business.ts`) |
| Website | `https://www.brokersconnect.net` |
| Privacy policy | `https://www.brokersconnect.net/privacy` |
| Account deletion URL | `https://www.brokersconnect.net/account-deletion` |
| Target SDK | 36 (Android 16), from React Native 0.86 with Expo SDK 57; minimum 24 (Android 7) |
| Build | an Android App Bundle (`.aab`) from `eas build --platform android --profile production`, signed with the upload key EAS keeps; Google re-signs it with the app signing key (Play App Signing) |

## Main store listing

`mobile/store/play/listing.js` holds it, in Arabic and English: the title,
the short description and the full description — the App Store's own
(`mobile/store.config.js`), so the two stores say the same thing.
`node store/play/listing.js` (from `mobile/`) prints every field to paste into
the Play Console, which has no metadata file to push. `pnpm release:check`
holds each to Play's limits (title 30 characters, short description 80, full
4,000).

Graphics, in `mobile/store/play/`, drawn by `python3 scripts/play-graphics.py`
from the app's own brand files:

| Asset | File | Play's requirement |
| --- | --- | --- |
| App icon | `icon-512.png` — the iOS icon's mark on white | 512 × 512 PNG, up to 1 MB |
| Feature graphic | `feature-graphic.png` — the Arabic lockup and the store subtitle on the app's paper colour | 1024 × 500 PNG or JPEG, no transparency |
| Phone screenshots | see below | 2–8, 320–3840 px a side, no side more than twice the other |

**Screenshots.** The App Store set from the iOS screens workflow is
1320 × 2868 — taller than twice its width, which Play refuses.
`python3 scripts/play-graphics.py --screens <artifact>/store` widens each onto
the paper colour (1434 × 2868) into `store/play/screens/`, and Play takes
those. They show an iPhone; once an Android build exists, screenshots taken on
it are better, and Google's policy asks that screenshots show the app as it
is. Either way, take them when production lists real jobs
(`docs/app-store.md`, "Screenshots").

## App content (Policy → App content)

**Privacy policy:** the URL above.

**Ads:** No, the app contains no ads.

**App access:** All or some functionality is restricted. Add two sets of
instructions, with the accounts `pnpm review-accounts` makes
(`docs/app-store.md`, "Review accounts") — the same two App Review uses:

- *Candidate*: the candidate email and password. "Tabs: Home, Jobs, My
  applications, Saved, Account. To apply: Home → Real estate companies (at the
  bottom) → App Review account → its listing 'Sales manager (app review
  listing)' → apply."
- *Employer*: the employer email and password. "Tabs: Home, My listings,
  Applicants, Consultants, Account. A new or edited listing waits for
  moderation before it shows."

The full walk-through, with the Arabic labels quoted as the app shows them, is
the App Store's review notes (`reviewNotes` in `mobile/store.config.js`); paste
it into "Any other instructions". Google's reviewers, like Apple's, should try
deleting an account last.

**Content rating** (the IARC questionnaire). Category: *All other app types*.

| Question | Answer |
| --- | --- |
| Violence, fear, sexuality, language, controlled substances, crude humour | No |
| Gambling, simulated gambling, real-money contests | No |
| Users can interact or exchange content | Yes — listings, company pages and consultant profiles are published by users; they can be reported, and are moderated (`docs/app-store.md`, guideline 1.2) |
| Shares the user's current physical location with other users | No |
| Allows users to purchase digital goods | No |
| Unrestricted internet access (a browser or search engine) | No — the in-app browser opens only the pages the app names |
| Is the app a web browser or search engine | No |

**Target audience and content:** 18 and over only. The Terms and the Privacy
policy are for people aged 18 and over, and onboarding asks for that
confirmation (`policy_acceptances`). Not designed for children; not in the
Designed for Families programme. "Could the store listing unintentionally
appeal to children?" No.

**News app:** No. **Government app:** No. **Financial features:** none.
**Health:** none. **COVID-19 tracing:** No.

**Advertising ID:** the app does not use one. No library in it asks for
`com.google.android.gms.permission.AD_ID`.

## Data safety

The same facts as the App Store's privacy label (`docs/app-store.md`, "App
privacy"), sorted into Play's categories.

**Overview answers**

- Does the app collect or share any of the required user data types? **Yes**
  (collects; see below).
- Is all of the user data collected by the app encrypted in transit? **Yes** —
  HTTPS to the website and Supabase only (App Transport Security on iOS;
  Android's default network security config refuses cleartext from API 28).
- Do you provide a way for users to request that their data is deleted?
  **Yes** — in the app (Account → Delete account) and on the web
  (`/account-deletion`).

**Shared: none.** Google does not count as sharing a transfer the user starts
and expects — applying to a listing sends the candidate's name, number and CV
to that company; a consultant who chooses to be shown in the directory is seen
by approved companies — nor one to a service provider processing data on the
operator's behalf (Supabase, Vercel, Resend, Expo's push and update services,
Cloudflare Turnstile). **Decide**: if you prefer to declare the application
transfer anyway, mark Name, Phone number, Files and docs and Other info as
shared, for App functionality.

**Collected** — each one processed ephemerally: **no**; purposes as listed.

| Play category → type | What it is | Required or optional | Purposes |
| --- | --- | --- | --- |
| Personal info → Name | the account's full name | Required | App functionality, Account management |
| Personal info → Email address | the sign-in address | Required | App functionality, Account management |
| Personal info → Phone number | the WhatsApp number on the profile | Required | App functionality |
| Personal info → User IDs | the account id | Required | App functionality, Account management |
| Personal info → Other info | work history, education, certifications and sales record on a consultant's profile; which Terms and Privacy policy versions were agreed to, and when | Optional | App functionality, Account management |
| Photos and videos → Photos | profile photo, company logo | Optional | App functionality |
| Files and docs → Files and docs | CVs, company verification documents | Optional | App functionality |
| App activity → App interactions | a company opening a consultant's profile, or asking for a consultant's number or CV (shown to the consultant as a count; daily limits) | Required | App functionality, Fraud prevention, security and compliance |
| App activity → In-app search history | saved searches, followed companies | Optional | App functionality |
| App activity → Other user-generated content | applications and their notes, listings, reports, help and deletion requests | Optional | App functionality |
| Device or other IDs → Device or other IDs | the push token registered for the phone; the random install id the update check sends to Expo | Optional (the push token only once notifications are allowed) | App functionality |

**Not collected:** location, financial info, health and fitness, messages
(SMS, email), contacts, calendar, audio, web browsing history, app info and
performance (no crash logs or diagnostics: the app has no analytics or crash
reporting SDK), advertising ID.

## Permissions

What the release build asks for (`mobile/app.config.ts`, and the manifests of
the Expo modules it includes), none of which needs a Play declaration form:

| Permission | From | Why |
| --- | --- | --- |
| `INTERNET`, `ACCESS_NETWORK_STATE` | React Native, `expo-image`, `expo-updates` | the website and Supabase; updates |
| `CAMERA` | `expo-image-picker` | photographing company papers for verification — asked when used |
| `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` | `expo-notifications` | pushes — asked from the prompt on Home, never at launch |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | `expo-local-authentication` | the optional app lock |
| `VIBRATE` | `expo-haptics` | haptic feedback |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` | `expo-image-picker`, `expo-file-system` | Android 12 and older only (`maxSdkVersion 32`) |

Removed: `SYSTEM_ALERT_WINDOW` (`blockedPermissions`) and `RECORD_AUDIO`
(`microphonePermission: false`). No location, contacts, SMS, call log,
`READ_MEDIA_*`, all-files access, exact alarms or foreground services — so the
Photo and video permissions policy and the other restricted-permission forms
do not apply.

## Before the first Android release (the owner)

In this order. The App Store list (`docs/app-store.md`, "Before the first
submission") comes first: the website's keys, the migrations, real listings on
production and the review accounts are shared.

1. **A Google Play developer account.** An organisation account needs a
   D-U-N-S number. A *personal* account created after November 2023 must run
   a closed test with at least 12 testers for 14 days in a row before it can
   publish to production — an organisation account avoids that.
2. **Create the app** in the Play Console with the identity above, and fill in
   App content and Data safety from this page.
3. **Firebase**, for pushes (`docs/app-store.md`, "Android, when it ships"):
   the Android app `net.brokersconnect.app`, its `google-services.json` as the
   EAS file variable `GOOGLE_SERVICES_JSON`, and the FCM V1 key uploaded with
   `npx eas-cli@latest credentials`. Without both, the Android app does not
   offer pushes.
4. **The build**, from `mobile/`: `pnpm release:check`, then
   `npx eas-cli@latest build --platform android --profile production`. EAS
   makes and keeps the upload key on the first build.
5. **The first upload by hand.** Google's API cannot create a release for an
   app that has never had one: upload the `.aab` from the EAS build page to
   Internal testing in the Play Console. Later builds can go with
   `npx eas-cli@latest submit --platform android`, which needs a Google
   service account key with release permission (EAS asks for it once), and
   which `eas.json` sends to the internal track as a draft — never straight to
   production.
6. **`ANDROID_CERT_SHA256` on Vercel**, so links to the website open the app:
   the SHA-256 of the *app signing* key from Play Console → Test and release
   → App integrity (that is the key Google signs the installed app with), and,
   comma-separated, the upload key's from `eas credentials` (for builds
   installed outside Play).
7. **Test on a real Android phone** from the internal track, through
   `docs/mobile.md` ("On a phone, before a release"), including its Android
   line: the lowest field of every form above the keyboard, Back on onboarding
   and on the second factor, the tab icons.
8. **Screenshots and graphics** (above), then promote the release from
   Internal testing when it is ready — by hand, in the Play Console.
9. After the listing is live: `MOBILE_PLAY_STORE_URL` on Vercel, and
   `MOBILE_MIN_ANDROID_APP_VERSION` only when an older build must stop.
