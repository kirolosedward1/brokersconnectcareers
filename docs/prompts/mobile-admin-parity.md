# Prompt: bring every admin tool on the website to the iOS app

Paste everything below this line into a new Claude Code session on the repository `kirolosedward1/brokersconnectcareers`, on a branch off `main` after PR #48 has merged (or off `claude/tender-davinci-dzouqf` before it has).

---

## Goal

Make the iOS app's **Admin** tab a complete, native equivalent of the website's admin console at `/admin/**`: every page, every read, every lever, the same rules, the same words — so an admin never needs the website for any admin task. Do not rebuild or redesign either client; extend what exists, in its own style, and keep every check green.

Read first, in this order:

1. `HANDOFF.md` — the stack, how to run checks, and the section "The admin console, on both clients".
2. `mobile/AGENTS.md` and `docs/mobile.md` ("The admin console in the app") — the app's rules and how it talks to the website.
3. `docs/security/THREAT_MODEL.md` §6 — the mobile door.
4. The app's existing admin code: `mobile/src/features/admin/{door,queries,accounts,levers}.ts`, `mobile/src/components/admin/{kit,decision-sheet}.tsx`, `mobile/src/app/(tabs)/(admin)/admin/**`, `mobile/src/lib/{tabs,links}.ts`, and the tests `mobile/tests/admin.test.tsx`, `mobile/tests/admin-accounts.test.tsx`.
5. The website's console: `src/app/[locale]/(app)/admin/**`, `src/components/admin/**`, `src/lib/actions/admin.ts`, `src/lib/actions/moderation.ts`, `src/lib/admin/{errors,params}.ts`, and the migrations that define the `admin_*` functions (316–319, 326–328, 344, 346–347, 355 — the latest definition of a function wins).
6. The mobile door: `src/lib/mobile-api/{contract,registry,admin-door,http,context}.ts` and `scripts/mobile-api.test.mjs`.

## How the two clients fit together (do not change this)

- **Reads** in the app go straight to Supabase under the admin's own session: the same tables under the same RLS, and the same `admin_*` SECURITY DEFINER functions the website's pages call. Every one answers an admin only (`is_admin()`, which is false at aal1 for an admin who has a verified authenticator), so a read must wait for the app's door to be `open` (`useAdminDoor()` in `mobile/src/features/admin/door.ts`; the `useOpen()` pattern in `queries.ts`). A failed read is an error with a retry, never "nothing waiting".
- **Writes** in the app are the website's own server actions, called through `POST /api/mobile/v1/actions/<name>` (`callAction` in `mobile/src/lib/api.ts`). Each admin action is listed in `ADMIN_ACTIONS` (`src/lib/mobile-api/contract.ts`), typed in `MobileActions`, and registered in `src/lib/mobile-api/registry.ts` as `name: { run: forAdmins(action) }`. `forAdmins()` applies the website console's own rule to the bearer token (`admin-door.ts`): aal2 when the admin has a verified factor; without one, refused while `ADMIN_MFA_REQUIRED` is on (the app reads that flag from `/api/mobile/v1/config`). Then the action's `assertAdmin()` and the database's `admin_begin()` check the role again. `scripts/mobile-api.test.mjs` pins the exact list and that every entry is behind `forAdmins`; update its expected list when you add one. **Never** import `createAdminClient` in the registry.
- **Every lever** in the app opens the one confirmation sheet (`openDecision()` → `DecisionSheet`, drawn once at the root by `DecisionSheetHost`): a title, what will happen and who is told, a reason box when the lever takes one (`'none' | 'optional' | 'required'`, required = at least 3 trimmed characters, `reasonMax` 500 unless the lever says otherwise), and "done" **only** after the website answered `ok`. A refusal stays in the sheet with the website's sentence (`admin.errors.<code>`, else `admin.errors.unknown`; `mfa_required`/`mfa_challenge` → `app.admin.door.*`); a request that never came back says `admin.errors.network` and claims nothing. Add a `Lever` kind in `mobile/src/features/admin/levers.ts` per new action; `useAfterLever()` invalidates `['admin']`, `['jobs']`, `['companies']` — add keys as needed.
- **Routes mirror the website's paths** (`/admin/...`) inside the `(admin)` route group; `mobile/src/lib/links.ts` `ADMIN_SCREENS` decides which `/admin/...` links open natively (today: the overview, jobs, jobs/<id>, reports, users, users/<id>, companies). As each page lands, extend that regex, and retire the "open on the website" fallbacks: `app.admin.fullConsole`, `fullConsoleHint`, `onWebsite`, `deletedTarget`, `companyRecord` and `showing` ("the rest are on the website"), plus `openOnWebsite()` calls, once nothing needs them.
- **Words come from the catalogues**, never from code: the website's `messages/{ar,en}.json` (`admin.*`, `dashboard.*`, `applicationStatus.*`, `jobStatus.*`, `reportReason.*`, `emailStatus.*`, …) and the app's own `mobile/src/i18n/messages/{ar,en}.json` under `app.admin.*` for anything app-specific (always both languages, Egyptian-colloquial Arabic in the tone of the neighbouring keys; numbers inside Arabic sentences via `t.markup(…, markupTags)`).
- **Conventions** (HANDOFF.md "Gotchas"): `appDirection` on every Modal's outermost view (`tests/rtl-modals.test.ts` enforces it); sheets via `useSheet()` and a root host, never inside list rows; `withTimeout` on anything that can stall; no `try/finally` (React Compiler); FlashList for lists with `useNextPage` + `PageFooter` for paging; `AdminGate` around every admin screen; icons only via `mobile/src/components/ui/lucide.ts` (add alphabetically; check the module exists under `node_modules/lucide-react-native/dist/esm/icons/`).
- **Privacy**, exactly as the website keeps it: no list or search ever carries an email or a phone (`admin_search_users` matches them but returns neither; never select `whatsapp_phone` or `profiles.*` in a console read); contact details only via `revealContact` with a reason, held in component state, never cached, logged or put in a route param; verification papers only via a per-tap 5-minute URL from `getDocumentUrl`, never a `storage_path`; never select `cv_path` or call `/api/cv` from admin screens; safety flags and company signals are console-only facts to weigh, never verdicts (word them with `admin.flag.*` / `admin.signal.*`).

## What the app already has (keep, do not duplicate)

Overview (`admin_overview`: the "needs a decision" row, marketplace figures, recent decisions, tab badge), listings review queue (pending view only) and one listing's review with approve / request changes / reject / take down / close / restore, reports (new and under-review queues, no filters, first 50 cases) with investigate / take down and resolve / resolve / no breach, accounts (every list view, searched and paged; one account's file in four tabs with every lever: approval, make/remove admin, block/allow sign-in, sign out everywhere, reporting restriction, reveal contact, note), companies' papers queue (pending view only) with view paper / verify / request changes / reject. Door states: open, challenge (→ `/mfa`), enrol (→ website account page), error (retry).

## What to build — every item, with the rules to mirror

Work in the order below; each numbered item is a commit (or a few), each with its tests, each leaving `cd mobile && pnpm check` and the root checks green. Where a website page has filters, views, sort order and page size, reproduce them exactly (read the page's `VIEWS`/`STATUSES` constants, `oneOf` fallbacks, `PAGE_SIZE` 25 or the page's own size, and the order clauses) unless noted.

### 1. Registry: the levers the app still lacks

Add to `MobileActions` + `ADMIN_ACTIONS` + the registry (behind `forAdmins`) and to `Lever`/`pullLever`:

| action | from | input (the zod schema is the truth) | reason | notes |
|---|---|---|---|---|
| `setJobFeatured` | admin.ts | `{ jobId, featured }` | none | audit `job.featured`/`job.unfeatured`, no notification |
| `setCompanySuspension` | admin.ts | `{ companyId, suspend, reason 3–500 }` | required | returns `{ takenDown }`; suspending takes active and pending listings down; nothing comes back on restore |
| `setAgentRestriction` | admin.ts | `{ agentId, restrict, reason 3–500 }` | required | restriction forces visibility hidden and tells the consultant; lifting keeps hidden |
| `closeReports` | moderation.ts | `{ ids: uuid[] 1–200, status, note?, abusive }` | required when `abusive` | deleted-target cases, and "dismiss as bad faith" per report line |
| `decideAppeal` | moderation.ts | `{ appealId, overturn, note? ≤1000 }` | optional on overturn, required (≥3) on uphold | note is sent to the appellant |
| `saveTaxonomy` | admin.ts | `{ kind, id\|null, nameAr, nameEn 1–80, slug? ≤60, governorateId? }` | none | slug permanent on rename; errors `invalid_slug`, `invalid_name`, `invalid_governorate`, `slug_taken` |
| `deleteTaxonomy` | admin.ts | `{ kind, id }` | none (confirm only) | `taxonomy_in_use` |
| `requeueEmail` | admin.ts | `{ emailId }` | none | returns `not_retryable` (not in `ADMIN_ERROR_CODES` — add a word for it in both catalogues). `isRetryable` lives in `src/lib/email/rebuild.ts`, which is server-only: extract the retryable template list into a pure shared module (e.g. `src/lib/email/retryable.ts`) that `rebuild.ts` and the app both import, so the app hides Retry where the website hides it |
| `closeDeletionRequest` | admin.ts | `{ requestId }` | none | records only; deletes nothing |

Update `scripts/mobile-api.test.mjs`'s expected list, `scripts/mobile-api.smoke.mjs`/`scripts/e2e/journeys.mjs` if they name an action that is no longer unlisted, `docs/mobile.md`, `docs/security/THREAT_MODEL.md` §6.

### 2. Overview — the rest of `/admin`

- All three stat rows as the website draws them (`admin.needsAttention`, `admin.marketplace`, `admin.population`), every cell linking to the native list it names once that list exists (`/admin/jobs?status=live|expiring|quiet|expired`, `/admin/applications`, `?status=unopened`, `/admin/companies?status=all|verified|suspended`, `/admin/users?role=…|status=…`, `/admin/agents`, `?visibility=restricted`). Include the cells the app lacks: `statQueueOld` (urgent tone), `statExpiring`, `statNoApplicants`, `statExpired`, `statUnopened` (with the 7-day delta on applications), `statCompaniesHiring`, `statCompaniesVerified`, `statCandidates`, `statEmployers`, `statAgents` (+ `statAgentsHint {hidden}`), `statSuspendedCompanies`, `statRestrictedConsultants`.
- **Account deletion requests** section (only while any is open): `support_requests` where `topic='account_deletion'` and `status='open'`, oldest first, ≤50; each row: reference (LTR mono), date, the account's name → `/admin/users/<id>` (or `admin.deletionRequestAccountGone`), the company → `/admin/companies/<id>`; lever `closeDeletionRequest` (no reason, confirm only). Select only `id, reference, created_at, user_id`; never the message.
- **Platform activity, 30 days** (`admin_trend`): three series (applications, published, signups) — reuse the app's `~/components/dashboard/trend-bars.tsx` style.
- **Recent decisions**: make each row open its target natively (`/admin/jobs/<id>`, `/admin/companies/<id>`, `/admin/users/<id>`, `/admin/agents/<id>`, `/admin/applications/<id>`), and add the "Audit log" link to the native audit screen.
- A search field at the top → the native search screen (item 11).
- The Admin tab's badge should match the website rail's sense of "waiting" (`admin_summary`: `queue_total + companies_pending + reports_open + appeals_open + accounts_pending`), or keep `waitingCount` from `admin_overview` and add appeals once `admin_summary` is read — pick one and say why in the code.

### 3. Listings — all views, search, filters, paging; the full review

- `/admin/jobs`: a view chip row for every website view in order — `pending` (default), `flagged`, `live`, `expiring`, `quiet`, `reported`, `expired`, `closed`, `rejected`, `draft`, `all` — with the exact query each view runs (read `src/app/[locale]/(app)/admin/jobs/page.tsx`: `flagged` uses `admin_flagged_pending_jobs(p_limit 500)` then `.in('id', …)`; `quiet` is active, published more than 3 days ago, no applications; `reported` joins open reports; `expired` is status expired OR active past `expires_at`). Search (`q`: UUID → `id`, else `looseArabicNeedle` over `title_ar/title_en/slug`), `?company=<uuid>` filter, 25 per page with `useInfiniteQuery`, the website's sort per view, and the columns: title, company (+ suspended badge), waiting days / expiry / date by view, applications count, status badge, featured mark; flags for the pending and flagged views (`admin_job_signals`, ≤100 ids per call). Inbound links `?status=…` and `?company=…` must select the view.
- `/admin/jobs/<id>`: add what the app's review lacks — application counts per stage (five head counts, `admin.applicationsCount`, "See all" → `/admin/applications?job=<id>`), **feature / unfeature** (`setJobFeatured`, offered only when `jobIsLive`), the company signals block (`CompanySignalList` semantics from `src/components/admin/safety.tsx`: each `admin.signal.*` with its counts and the companies it names, each a link), the public page link, the reports' reporter names linking to `/admin/users/<id>`, and the **Record**: notes + audit trail (`moderation_notes` and `admin_audit_log` for `target_type='job'`, 50 each, merged newest first, `auditLabel`, `admin.viaDirect` chip when `via='direct'`) with an **Add note** lever (`addModerationNote`, targetType `job`).

### 4. Companies — all views, search, paging; one company's page

- `/admin/companies`: views `pending` (default; `verification_status='pending'` with `company_documents!inner` filtered to pending, oldest first), `verified`, `unverified`, `rejected`, `suspended` (`suspended_at is not null`), `all` (newest first); search over `name_ar/name_en/slug`; 25 per page; row: logo, name, listings count, members count, verification badge, suspended badge, joined date.
- `/admin/companies/<id>` (new): facts (name, slug, type, district, website, credits, verified at, created), suspended banner with `company_moderation.suspension_reason`; **papers** (every status; type, date, «review_note», status badge, open via `getDocumentUrl` per tap); **members** (name → `/admin/users/<id>`, role, owner badge, approval badge); **listings** (newest 20 of every status, exact total, applicants count, status badge → `/admin/jobs/<id>`; the open-reports count on its listings → reports screen filtered `type=job`); **reports about the company**; **safety flags + signals** (`admin_company_signals`); **record** (audit + notes + add note). Levers as the website offers them: verify (not verified; note optional; body `verifyCompanyBody` when papers pending else `verifyWithoutPapers`; version), request changes (pending; reason required → company), reject (pending or unverified; reason required → company), revoke (verified; reason required, on the record), **suspend** (`suspended_at` null; reason required → members; show `takenDown` in the toast) / **lift suspension** (reason required, on the record; brings no listing back).

### 5. Consultant profiles (`/admin/agents`, `/admin/agents/<id>`) — new

- List: every `agent_profiles` row with the owner's `full_name`, `avatar_url`, `approval_status`; views by `visibility`: `all` (default), `public`, `verified_employers_only`, `hidden`, `restricted` (`restricted_at not null`); search with the website's slug-or-name rule (`/^[a-z0-9-]+$/` searches slugs only, otherwise names via the loose Arabic pattern — replicate exactly); newest first; 25 per page; columns: name, slug (LTR), years (`admin.yearsN`), availability, account standing, visibility/restricted badge.
- Detail: the owner (name → `/admin/users/<id>`, standing), slug, years, tracks (`track.*`, `formatList`), districts (resolve ids with the app's `useDistricts()`), developers, languages, availability, visibility, "CV uploaded" yes/no only, headline(s), created; **reports about the profile** (every status, reporter → user); **record** (audit + notes + add note, targetType `agent`); levers **restrict profile** (when not restricted; reason required → consultant) / **lift restriction** (when restricted; reason required, on the record); public page → the app's `agents/[slug]` screen when not restricted and not hidden.

### 6. Applications (`/admin/applications`, `/admin/applications/<id>`) — new, read-only

- List: views `all` (default), `unopened` (status `new`, `employer_viewed_at` null, older than 7 days; oldest first), `new`, `shortlisted`, `interview`, `hired`, `rejected`; filters `?job=<uuid>`, `?candidate=<uuid>`; search; 25 per page; columns: candidate (→ user), listing (→ job), company, status, sent date, opened (yes/no). The banner `admin.applicationReadOnly` / lede `admin.applicationsLede`.
- Detail: candidate, job and company (links), status badge, experience band, the candidate's cover note, the employer's decision note (the candidate sees it), sent / opened dates; **history** (`application_events`: from → to, actor name and role, date, oldest first); the employer's private notes as a **count only**; **record** (audit + notes + add note, targetType `application`). No lever moves an application. Never `cv_path`, never `/api/cv`.

### 7. Reports — filters, closed views, deleted targets, bad faith

- Add the website's filters to the reports screen: type (`job|company|agent`), reason (the `reportReason` list), severity (any/2+/3), from/to day (Cairo days via `cairoDayStart`), "repeat reporters" (`p_min_reporters 2`); the closed views `resolved` and `dismissed` (`admin_report_rows` with `p_status`, 30 per page, per-report cards); paging on the open views (`admin_report_cases` `p_limit 20`, `p_offset`). Keep reading only the reports drawn (`admin_report_rows` takes ≤500 ids).
- Per report line: the reporter's record (`admin.reporterRecord {filed, dismissed, abusive}`), "account under a week old" and "reporting restricted" badges, the deleted-reporter and system-flag cases as now, and the **dismiss as bad faith** lever (`closeReports { ids:[id], status:'dismissed', abusive:true }`, reason required) on user reports that are open or investigating.
- Cases whose target was deleted: show the snapshot excerpt and the levers **close as handled** / **close: no breach** (`closeReports` with the case's open ids; reason optional).
- Listing and company signals on live cases (`admin_job_signals` / `admin_company_signals`, ≤100 ids per call).
- Company and consultant targets open the native company / consultant screens (items 4 and 5).

### 8. Appeals (`/admin/appeals`) — new

`moderation_appeals` with appellant and decider names; views `open` ("Waiting", oldest first) and `decided` ("Answered", newest decided first); 20 per page. Card: subject kind and label (→ its native screen), appellant (→ user), message, the decision snapshot, filed date; decided ones show the outcome, the decider and the note. Levers on open appeals: **reverse the decision** (`decideAppeal overturn:true`, note optional ≤1000 → the person) and **let it stand** (`overturn:false`, note required ≥3 → the person). Add the appeals count to the badge logic chosen in item 2.

### 9. Audit log (`/admin/audit`) — new

`admin_audit_log`, newest first, 50 per page; filters: type (`all|user|company|job|agent|application|taxonomy|direct` — `direct` is `via='direct'`), `?actor=<uuid>`, `?target=<id>`; each row: `auditLabel`, target label (→ the target's native screen), actor, date, «reason», `admin.viaDirect` chip. Read only behind the open door (an aal1 admin gets zero rows, which must never read as "no decisions"). Do not copy the website's reused `admin.filteredToOne` wording for the audit filter; add a correct key in both catalogues.

### 10. Taxonomy (`/admin/taxonomy`) — new

Tabs `district` (default), `governorate`, `developer`, `fixed`. Rows from the three tables (developers by `name_en`, others by id) with `admin_taxonomy_usage(p_kind)` counts. **Add** (`saveTaxonomy` with `id:null`; nameAr, nameEn, slug, governorate for districts), **rename** per row (nameAr, nameEn, and governorate for a district; the slug is permanent), **delete** (`deleteTaxonomy`, confirm only, offered only when uses = 0; otherwise the `admin.inUse {count}` badge). The fixed tab lists the constants from `src/lib/taxonomy.ts` read-only with `admin.fixedListsHint`. Invalidate `['taxonomy']` after a change (the app persists taxonomies across launches).

### 11. Search (`/admin/search`) — new

One field → `admin_search(p_query)` when the trimmed query has ≥2 characters (≤120): results grouped by kind (`admin.kind.*`), ≤6 per kind, each opening its native screen; `admin.searchNothing` when empty. Reachable from the overview's search field.

### 12. Email, background work, security (`/admin/email`, `/admin/operations`, `/admin/security`) — new, read-mostly

- **Email activity**: status chips with counts (`email_activity_summary`, 30 days; order all, queued, sent, delivered, bounced, failed, suppressed, cancelled), the list (`email_activity(p_limit 200, p_status)`: recipient address — the one place personal data appears, template, entity, status, dates), and the configuration banner (the app cannot read `process.env`; add `mailConfigured: boolean` and the missing variable **names** to `/api/mobile/v1/config` or a small admin-only read, never values).
- **Background work**: scheduled tasks (`scheduled_job_overview`, spine order `expire-jobs, email-retry, daily-digest, job-alerts, new-jobs` then extras), the outbox figures (`outbox_overview`), dead letters (`email_dead_letters(p_limit 100)`) with the **Retry** lever (`requeueEmail`; offered only when the template is retryable and `entity_id` is set), recent runs (`recent_job_runs(p_limit 50)`).
- **Security**: `security_summary` (24-hour strips as the website's two `StatStrip`s), latest 50 `security_events`, latest 50 `audit_log` rows, and `abuse_limits` (read-only table).
- The console-wide **mail-off banner** on every admin screen when mail is not configured (same source as above).

### 13. Links, badges, strings, docs

- Extend `ADMIN_SCREENS` in `mobile/src/lib/links.ts` to every path above, so pushes, universal links and the overview's cells open natively; `tests/links.test.ts` / `tests/routing.test.tsx` cover each.
- Remove the "on the website" fallbacks and their keys once unused (the app's `messages.test.ts` fails on orphans only if that rule exists — check; the website's `scripts/messages.mjs` does fail on unused `admin.*` keys, so keep the website's keys in use or remove them there too).
- Update `docs/mobile.md` ("The admin console in the app"), `HANDOFF.md` (the console section and open item 11), `docs/security/THREAT_MODEL.md` §6.

## Tests and definition of done

- For each screen: a test in `mobile/tests/` (modelled on `tests/admin.test.tsx`: the fake server, `signIn` at aal2 with a factor, `renderRouter`) that asserts the real request bodies and the real rules — which levers appear in which state, the exact `callAction` input, that nothing says "done" before `ok`, that a failed read shows an error (never "nothing"), that the under-the-door states hold.
- `scripts/mobile-api.test.mjs` updated for every registry change; `pnpm test:admin` if any SQL changes (prefer none: every function the website needs already exists).
- `cd mobile && pnpm check` (typecheck, lint, shared-code guard, update check, licences, Jest), `cd mobile && pnpm export:ios`; root `pnpm typecheck`, `pnpm test:messages`, `pnpm test:mobile-api`, `pnpm test:db`.
- Commit small, one tool per commit, descriptive messages; push to the branch; do not open a PR unless asked.
- Done when: every website admin route in the inventory above has a native screen reachable from the Admin tab and from its `/admin/...` link; every website lever exists in the app with the same offering rules, reason rules and words; `ADMIN_SCREENS` covers all of them; no `openOnWebsite` remains in the admin screens; all checks green.
