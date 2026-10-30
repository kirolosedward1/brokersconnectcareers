# 10 · Gaps found while building Phase A

Phase A drew only what the platform records. These are the board elements
it left out because nothing backs them yet, each with what it would take.
They are smaller than 01–09, and most could ride on one migration each.

## Notifications (Alerts, NotificationPrefs, EmployerNotifPrefs)

Built in A4: per-kind switches by channel (phone: `profiles.push_*`,
migration 335; email: `profiles.notify_*`), quiet hours, and a recommended
preset.

Missing:

| Board element | Needs |
|---|---|
| WhatsApp as a channel | WhatsApp Business API (templates approved by Meta, opt-in record, cost). A product decision before any schema. |
| Digest frequency (instant, hourly, daily) and time («8:30 ص») | `profiles.applicant_digest_every text check (in ('instant','hour','day'))`, `profiles.digest_at time`. The digest cron reads them. Today the digest is one daily email (`notify_applicant_digest`). |
| "Strong match" applicant push (≥85%) | A match score on the server. Today the match is computed on the phone (`features/jobs/match.ts`). It would need to move to SQL, then a push category of its own. |
| Withdrawal and team events as separate switches | Split `push_applications` into `push_applications_new`, `push_withdrawals` and `push_team`, with the old column kept as the default. |
| Per-listing switches and "who on the team is told" | `job_watchers(job_id, member_id, channels)`, which depends on 03 (scopes). |
| Reminder for applicants waiting more than N days | A nightly job over `applications.status = 'new'` and `created_at`. No schema beyond a `profiles.remind_waiting_days int`. |

## Privacy (Privacy board)

Built in A4: directory visibility (three choices), usage analytics opt-out,
the data export, the hidden list, and deleting the account.

Missing:

| Board element | Needs |
|---|---|
| Hide my card from named companies | `agent_hidden_from(agent_id, company_id)`, read inside `get_agent_card` and the directory search. RLS: the agent reads and writes their own rows. |
| Choose which fields companies see (sales record, expected pay, current employer, availability, last seen) | Columns `agent_profiles.show_record`, `show_pay`, `show_employer`, `show_availability`, `show_last_seen` (default true), applied in `get_agent_card`. "Last seen" also needs a `last_active_at` the platform does not keep today. |
| Who may reveal my number | Today it follows visibility. An extra `reveal_by text check (in ('verified','applied_to'))` in `reveal_agent_contact`. |
| Tell me at every reveal, and the reveal log | The ledger is **already readable by its subject** (`agent_contact_reveals_subject_read`, migration 304). The log can be built now from company names, with no migration. The person who revealed is not readable, so the board's «سارة من فريق التوظيف» needs a definer function that returns the viewer's first name only. The push per reveal needs a new notification kind `contact_revealed`. |
| WhatsApp preferred over a call; contact hours | `agent_profiles.prefers_whatsapp boolean`, `contact_hours jsonb`. These are also shown on RevealConfirm. |
| Crash reports switch | The app keeps the last crash on the phone (`lib/crash-log.ts`) and sends nothing on its own, so there is nothing to switch off yet. |

## Job-seeking status (Availability board)

Built in A4: the three availability states, tracks and districts, and the
live count of matching listings.

Missing: a fourth state «خلال شهر» (adds a value to `agent_availability`;
the website's filters and labels follow), notice period, earliest start
date, employment type wanted (full, part, commission only), contact hours,
a 30-day "still true?" reminder, and the board's «تظهر لـ 41 شركة» line.
The columns are simple: `agent_profiles.notice text`, `start_on date`,
`employment_types employment_type[]`, `status_confirmed_at timestamptz`.
The company count needs a definer aggregate over companies searching those
districts, and the database does not keep directory searches today. **That
line stays out until it does.** The minimum basic pay and client type from
the board live on the saved search with alerts (onboarding already writes
one). Editing them belongs on the saved search screen.

## Support (Support board)

Built in A4: the app page's questions, email, a problem report with the
version filled in, service status from `/api/health`, and the version.

Missing:

| Board element | Needs |
|---|---|
| In-app conversations and tickets | `support_requests` **exists** (migration 201, `submit_support_request`, `admin_answer_support_request`). A general `submitSupportRequest` mobile action (today only `requestAccountDeletion` uses the RPC), plus a policy or function for a person to read their own requests and the answers. **Verify** what migration 201 already allows them to read. |
| Support WhatsApp line and hours | A number and hours in `/api/mobile/v1/config` (operator setting, no schema). |
| Service status history («آخر عطل») | An incidents table kept by the operator, or a status page. `/api/health` only answers "now". |
| Full FAQ («كل الأسئلة · 28») | The help content lives on the website (`appPage.faq`, 6 questions). A longer list is copy work, not schema. |

## Listing performance (ListingStats board)

Built in A5: views (total), applications, apply rate, and applications
day by day over 7, 14 or 30 days, with repost and edit.

Missing: **daily views** (the platform keeps `jobs.view_count` as a total
only), the rise or fall against the period before, and the **category
average** apply rate. Proposal: `job_view_days(job_id, d date, views int,
primary key (job_id, d))`, incremented where `view_count` is incremented
today, and `track_apply_rates()`, a definer aggregate per track over the
last 90 days that returns a value only when at least 20 listings are behind
it.

## Revealing a contact (RevealConfirm board)

Built in A5: the confirmation, who it is recorded under, and the same-day
rule. Missing: the monthly balance («الرصيد بعد الكشف 7 من 20») and
«كشف سابق». Reveals are limited per hour and day, not counted against a
balance, and that is decided: no balance. The company
cannot read the ledger. A definer `my_company_revealed(agent_id)` returning
the last reveal date would back «كشف سابق».

## Company onboarding (OnbCompany1–3)

Built in A2 within the schema: one district and `company_type` of
`brokerage | developer`. Missing: more company types (`marketing`,
`property_management`, …, which needs the enum extended and the website's
filters) and several districts (covered by 7b, branches).

## Appearance (Appearance board)

Built in A4. Missing, and native rather than schema: alternate app icons
(a config plugin and a new build), and the language switch, waiting on
`ENGLISH_ENABLED` (English is not published yet). Also: "open company links
inside the app" and "start screen". These are phone settings, and could be
added to `app-preferences.ts` when asked for.

## Interviews today (EmployerHome)

See 09.

## Built (2026-10-30)

- **«كشف سابق»** (migration 381). `my_company_revealed(handle)` gives when
  the caller's company last revealed a consultant, within the 90 days the
  ledger keeps. The confirmation says it.
- **The consultant's reveal log** (migration 381). `my_contact_reveals()`
  lists which companies revealed the consultant's number and when. It names
  the company, never who on its team pressed (that is the company's own
  activity log). It is shown as «من كشف رقمك» under Privacy. The push per
  reveal is not built: it needs a notification kind of its own.
- **Daily views** (migration 382). `job_view_days` counts views per Cairo
  day, written by `increment_job_view()` beside the total, which is counted
  as before. Only the listing's company reads it. The stats screen draws
  «المشاهدات يومًا بيوم» under the applications. The category average is
  still not built.
- Tests: `supabase/tests/reveal-reads.test.mjs` and
  `supabase/tests/job-view-days.test.mjs`.

Everything else in this doc stays as written: each needs a product decision
or a design of its own.

