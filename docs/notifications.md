# Notification architecture

How BrokersConnect tells people that something happened: the in-app bell,
email, and the log behind them. Written against migrations 17–70 and
`src/lib/notifications/`.

## 1. Event architecture

```
BUSINESS EVENT ──► publish(event) ──► in-app (the bell) ──► email ──► delivery log
  (an action or        src/lib/          notifications         email_log       email_log status
   the database)       notifications/    table                 outbox row      + Resend webhook
                       events.ts
```

**Pages and actions do not send notifications.** An action records its
business change, then calls `after(() => publish({ type: ... }))`. What that
event causes — who hears, on which channel — is decided once, in the `ROUTES`
table in `src/lib/notifications/events.ts`. No action imports an email
function any more; the only direct callers of `src/lib/email/notify.ts` are
`events.ts` itself, the retry sweeper (`rebuild.ts`) and the two scheduled
digests (which are delivery modes, not events — see §5).

**The in-app half is written by the database, not by `publish()`,** for every
event that has a row to hang a trigger on. The trigger runs in the same
transaction as the change it reports, so it cannot be skipped by a code path
that forgot to publish, and it can never announce something that rolled back.

| Event | Trigger / writer (in-app) | Email handler(s) | Who hears |
|---|---|---|---|
| `APPLICATION_CREATED` (incl. NEW_APPLICANT) | `on_application_created` | `notifyEmployerOfApplication`, `notifyCandidateOfApplication` | every company member; the applicant |
| `APPLICATION_STATUS_CHANGED` | `on_application_moved` | `notifyCandidateOfStatus` | the candidate |
| `APPLICATION_WITHDRAWN` | `on_application_withdrawn` (only if shortlisted) | `notifyApplicationWithdrawn` | company members; the candidate (email receipt) |
| `JOB_SUBMITTED` | — (on-screen receipt) | `notifyJobSubmitted` | the member who submitted (owner if they've left) |
| `JOB_APPROVED` / `JOB_REJECTED` | `on_job_moderated` | `notifyEmployerOfModeration` | every company member |
| `JOB_EXPIRING` / `JOB_EXPIRED` | `emit_job_expiry_notifications` sweep | `notifyJobExpiry` | every company member |
| `COMPANY_VERIFIED` / `COMPANY_VERIFICATION_REJECTED` | `on_company_verified` | `notifyCompanyVerification` | every company member |
| `ACCOUNT_APPROVED` / `ACCOUNT_SUSPENDED` | `on_approval_changed` | `notifyAccountDecision` | the account holder |
| `ACCOUNT_ONBOARDED` | — | `notifyWelcome` | the new account |
| `PROFILE_CREATED` | — | `notifyProfileReady` | the consultant |
| `PROFILE_VISIBILITY_CHANGED` | `on_agent_visibility_changed` | `notifyVisibilityChanged` | the consultant |
| `SECURITY_EVENT` (`password_changed`) | written by `publish()` (evidence-gated) | `notifyPasswordChanged` | the account holder |

Two events have no row change to trigger on:

- **Password change** happens in the browser against `auth.users`; the server
  only hears afterwards (`announcePasswordChange`). `publish()` writes the bell
  row itself, via the service-role-only `notify()`, and only if
  `auth.users.updated_at` moved in the last five minutes — the same evidence
  rule the email uses, so a signed-in caller cannot conjure a security notice.
- **Job expiry** is a date passing. `emit_job_expiry_notifications()` is a
  set-based, idempotent sweep. The nightly cron runs it for every company, and
  the bell (`NotificationMenu`) and `/notifications` run it for the viewer's
  own company via `sync_my_job_notifications()` — which matters because the
  cron cannot run on a deployment without `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Notification schema

`notifications` (migration 17, extended by 68):

| column | meaning |
|---|---|
| `id` | uuid |
| `user_id` | the recipient; one row per person (a company of 3 gets 3 rows) |
| `kind` | `notification_kind` enum — 14 values |
| `payload` | **data, never prose**: ids plus a snapshot (titles in both languages, status, note, visibility, expires_at). The sentence is built at read time in the reader's language. |
| `href` | locale-free deep link, re-checked when followed (§4) |
| `read_at` | null = unread; the only user-writable column |
| `created_at` | timestamp |
| `dedupe_key` | what makes two notifications the same one, per recipient (§3) |
| `folded_into` | set on an applicant notice absorbed into an unread "N new applicants" row (§4); hidden from the feed, kept for its key |

Indexes: `notifications_feed_page_idx (user_id, created_at desc, id desc)` for
the keyset-paged feed; `notifications_unread_idx (user_id) where read_at is
null` for the badge; `notifications_dedupe_idx unique (user_id, dedupe_key)
where dedupe_key is not null` — the idempotency lock.

RLS: a reader selects, marks read and deletes their own rows. **Nobody may
insert** — every row comes from a trigger or the service role — and
`guard_notification_update` now rejects any change except `read_at` by
comparing the whole row (so future columns are protected by default).

## 3. Idempotency

Every writer supplies a deterministic key and inserts `on conflict do
nothing`. The unique index is the lock, so retries, double clicks, webhook
replays and two concurrent workers all collapse into one row without anybody
checking first.

| kind | key |
|---|---|
| `application_received` | `application_received:{job}:{candidate}` — apply → withdraw → apply is one notice |
| `application_submitted` | `application_submitted:{application}` |
| `application_moved` | `application_moved:{application}:{status}` — flapping is one notice per stage; moves back to `new` are silent |
| `application_withdrawn` | `application_withdrawn:{job}:{candidate}` |
| `job_published` / `job_rejected` | `…:{job}:{version}` — the row version (migration 50) distinguishes a re-approval from a replay |
| `company_verified` | `company_verified:{company}` — once ever |
| `company_verification_needed` | `…:{company}:{version}` — each refusal can carry a new note |
| `account_approved` / `account_rejected` | `…:{user}:{UTC hour}` |
| `job_expiring` / `job_expired` | `…:{job}:{expires_at epoch}` — a reposted listing that ends again is a new event |
| `profile_visibility_changed` | `profile_visibility:{user}:{value}:{Cairo day}` |
| `password_changed` | `password_changed:{user}:{auth updated_at}` |

The email outbox (`email_log.dedupe_key`, migration 27) uses the same
vocabulary, with `:{member}` appended where one event goes to several inboxes.

## 4. In-app behaviour

- **Read / unread:** `read_at`. Unread rows show a dot plus screen-reader text.
- **Open one** (`openNotification` server action → `open_notification(id)`):
  each row is a `<form>` button, not a link — marking read is a write, and a
  GET that writes would be triggered by the router's prefetcher. Works without
  JavaScript. `open_notification` is security-invoker and RLS-scoped: another
  person's id updates and returns nothing.
- **Mark all read** (`mark_notifications_read(p_up_to)`): bounded by the
  newest row the screen displayed, so a stale tab cannot clear a notification
  that arrived after it rendered.
- **Deep links respect roles:** `safeNotificationHref()` in
  `src/lib/notifications/links.ts` mirrors the route guards
  (`/employer` → employer/admin, `/dashboard` → candidate/admin except
  `/dashboard/account`, `/admin` → admin, public sections → anyone) and refuses
  anything off-site (`//host`, `/\host`, schemes, `..`, control characters). A
  refused link lands on `/notifications?link=unavailable`.
- **Deleted targets:** when the link is to the listing itself, the action checks
  it still exists *for this reader* (their own session/RLS) and otherwise lands
  on `/notifications?link=gone` with an explanation instead of a 404.
- **Applicant grouping:** while a member has an unread "new applicant for X",
  later applicants to X fold into it (`payload.count`, bumped to the top) rather
  than each adding a row. Each applicant still gets their own keyed row
  underneath (already read, `folded_into` the head), so the no-repeat rules
  hold. Reading the row ends the group; the next applicant starts a new one, so
  "3 new" always means "since you last looked". Members fold independently.
- **Pagination:** 20 per page, keyset on `(created_at, id)` via `?before=`
  cursor, one extra row fetched to know if there is a next page. The bell shows
  the latest 6. Nothing ever loads the whole feed.
- **Two tabs:** each tab broadcasts its rendered unread count on a
  `BroadcastChannel`; a tab holding a different count calls `router.refresh()`.
  Returning to a tab idle for over a minute also refreshes. Both converge in one
  round and keep client state.
- **Mobile:** the panel pins under the header on narrow screens (existing);
  rows are full-width buttons ≥ 44px tall; long titles wrap
  (`overflow-wrap:anywhere`); pagination buttons are `min-h-11`.

## 5. Preferences

Preferences govern **email only**; the bell is the record of what happened on
your account and is never switched off.

| switch | governs | default |
|---|---|---|
| `notify_applications` | employer: new-applicant emails | on |
| `notify_applicant_digest` | employer: batch those into one daily email (mode, not a second subscription) | off |
| `notify_status` | candidate: application moved; employer: moderation, expiry | on |
| `notify_digest` | candidate: weekly saved-search/follow digest, profile nudges | on |

Essential messages check **no** preference and carry no unsubscribe link:
application receipt, account approved/suspended, company verification,
password changed, visibility changed, welcome, withdrawal receipt. Each switch
is per person, so widening company emails to every member (this change)
widened nothing anybody had turned off. Unsubscribe links use a random
per-profile token (migration 8), with RFC 8058 one-click headers.

## 6. Delivery channels and failures

| channel | how | log |
|---|---|---|
| in-app | trigger in the business transaction, or `publish()` for the two exceptions | the `notifications` row itself |
| email | `publish()` → `notify.ts` → `deliver()` → Resend | `email_log`: `queued → sent → delivered / bounced / complained / failed / suppressed` |

- **A notification failure never rolls back the business write.** Every
  trigger body catches its own error and raises a `WARNING` (with the id) to
  the Postgres log; the application/listing still commits. Tested by breaking
  the table and applying.
- **An email failure never erases the in-app row.** They are separate writes;
  the in-app one committed before the email was attempted. `dispatch()`
  isolates every channel (tested).
- **Retention:** read notifications older than 180 days are deleted — for the
  reader whenever they mark their feed read, and for everybody by the nightly
  cron (`prune_notifications`, 5,000 per run). Unread rows are never pruned.
- **Retries:** the outbox row is written before sending; `/api/cron/email-retry`
  (hourly) re-derives and re-sends failed rows (the outbox now hands it the
  recipient too, so a submission receipt retries to the submitter), max 3 attempts, 3-day window;
  4xx errors other than 408/429 exhaust immediately; hard bounces and
  complaints are suppressed.

## 7. Tests

| suite | covers |
|---|---|
| `supabase/tests/notifications.test.mjs` (65) | duplicates (apply/withdraw/reapply, double-click, flapping, back-to-new, two concurrent writers), retries/replays, key tampering, writer not callable by users, failure isolation (application commits with a broken bell), expiring/expired sweep incl. label-lies-date case + idempotent reruns + renewal, sweep scoping (own company / candidate / anon / other companies), verification refusal, visibility dedupe, open-one/read-state/others' ids, two-tab bounded mark-all, keyset pagination over 50 tied timestamps + index use, deleted targets, wrong-role rows and stored links, applicant folding (fold, no double count on reapply/replay, fresh group after reading, tamper-proof count, cascade, per-member state), 180-day retention (own/unread/recent/others, cron sweep, not user-callable), retry sweeper receives the recipient |
| `scripts/notification-links.test.mjs` (29) | role-aware deep links, off-site/injection refusals, cursor round-trip and hostile cursors |
| `scripts/notification-dispatch.test.mjs` (8) | email down → bell intact; bell down → email sent; one email throwing doesn't stop the next; failures logged |
| existing `policies`, `schema`, `email` suites | unchanged and green: RLS, no forged inserts, definer-function exposure pinned |

Run `pnpm test:notifications`, or everything with `pnpm check`.

## 8. Remaining work

- **Live-browser verification.** The suites run against the real migrations in
  PGlite; the UI was typechecked and built but not exercised in a browser
  against a live Supabase project (none was reachable from the build
  environment). Worth a manual pass on a phone: open a notification from the
  bell, "Older" paging, two tabs.
- **Production crons need `SUPABASE_SERVICE_ROLE_KEY`.** Without it, email
  (which requires the outbox) and the nightly sweep do not run. The bell's
  expiry notices still appear via the console-side sweep.
- **Realtime.** The bell updates on navigation, cross-tab broadcast and tab
  refocus, not by push. Supabase Realtime on `notifications` would make it live.
- **In-app preferences.** No per-kind mute for the bell. Nothing in it is
  high-volume any more (applicants fold), so this is deferred until asked for.
- **Digests** (`job-alerts`, `daily-digest`) still call their send functions
  directly: they are scheduled batch deliveries rather than business events,
  and already dedupe per run.
