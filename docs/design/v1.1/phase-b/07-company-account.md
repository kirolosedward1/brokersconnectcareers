# 07 · Company account

Boards: **CompanyAccount**, **CompanySettings**. Hiring status and pausing
intake, ownership transfer confirmed by both people, a backup owner,
branches, the company's WhatsApp number and reply hours, default screening
questions, automatic deletion of closed applications, and suspending or
deleting the company with a grace period.

## What exists

- `companies` has one `owner_id`, one `district_id` and a `company_type`
  (`brokerage | developer`). `saveCompany` edits the profile.
- An owner cannot delete their account while they own a company. They file
  a support request (`requestAccountDeletion`, migration 330), and an admin
  decides.
- Closed listings keep their applications indefinitely.

## Proposal (migration `37x_a_company_runs_its_own_account`)

Split into three PRs, because each stands alone:

### 7a. Hiring status, contact and reply hours

```sql
alter table companies
  add column hiring_status text not null default 'open' check (hiring_status in ('open','paused')),
  add column paused_until  date,
  add column whatsapp_phone text,        -- public on the company page only when set
  add column reply_hours   jsonb;        -- {days:[0-6], from:'10:00', to:'18:00'}, Cairo time
```

`paused` stops new applications. The apply path (the website's apply
action and the database check behind it) refuses with `company_paused`.
The listing says so, and listings stay up. The response
line from migration 370 is unaffected.

### 7b. Branches and more than one district

```sql
create table company_branches (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  name_ar text not null, name_en text,
  district_id int references districts(id),
  created_at timestamptz not null default now()
);
alter table jobs add column branch_id bigint references company_branches(id) on delete set null;
```

This answers the OnbCompany boards' several districts without changing
`companies.district_id` (kept as the head office). Scopes in 03 can then name
a branch.

### 7c. Ownership, backup owner, deletion with grace

```sql
alter table companies add column backup_owner_id uuid references profiles(id);
create table company_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  from_id uuid not null references profiles(id),
  to_id uuid not null references profiles(id),
  code_hash text not null,                 -- a code the receiver confirms with
  status text not null default 'pending' check (status in ('pending','accepted','cancelled','expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
alter table companies add column deletion_requested_at timestamptz;
```

- Transfer: the owner starts it, the receiver (who must already be a member)
  accepts with the code from their email. Both get emails. Requiring MFA
  for both people is recommended.
- Deletion: the owner asks, the company is hidden at once, and a nightly job
  deletes it after **N days** unless cancelled. This replaces the
  support-request path for owners. **Decision needed: N** (the board says
  14).
- Auto-deletion of closed applications: `companies.purge_closed_after_days
  int`. A nightly job deletes applications to listings closed longer than
  that. The candidate's own copy (their "my applications" row) goes with
  them. **Decision needed:** do candidates keep a record of applications a
  company purged?

### Default screening questions

Out of this doc. They need a questions model on listings and answers on
applications, and deserve a design doc of their own.

## Decisions (2026-10-30)

1. Deletion grace period: **14 days**.
2. Candidates **keep a record** of applications a company purged.
3. Ownership transfer only **to an existing team member**.

## Built (2026-10-30): 7a, hiring status, contact and reply hours

- **Migration 378, `a_company_says_when_it_hires`.**
  - New columns on `companies`: `hiring_status` (open or paused),
    `paused_until`, `contact_whatsapp` (international form) and
    `reply_hours` (`{days, from, to}`, Cairo time, 0 being Sunday). Each has
    a shape check.
  - `company_is_hiring()` reads a pause as over once its day has passed in
    Cairo. Nothing has to run on that day.
  - A trigger on applications refuses with `company_paused`, so every door
    is refused alike.
  - Test: `supabase/tests/company-hiring.test.mjs`.
- **Website:**
  - New `saveCompanyHiring` action, for company admins, under the update
    policy.
  - `applyToJob` answers `company_paused`, and the website's apply form says
    `apply.companyPaused`.
  - The website's company page and settings for this come later. Its shared
    public column list is unchanged, so code that ships before the migration
    still reads.
- **App:**
  - A paused company's listing says so, and until when, in place of Apply,
    and the pinned bar is not offered.
  - The company page shows the notice, the reply hours («ترد عادةً الأحد–الخميس،
    من 10:00 إلى 18:00 بتوقيت القاهرة») and a WhatsApp button.
  - The admin's «التوظيف والتواصل» card on the company page sets all of it:
    pause until turned back on, or for a week, two weeks or a month.
  - The app reads these columns directly. A failed read means open.

## Built (2026-10-30): 7c, ownership, deletion with grace, purging

Migration 379, `who_owns_the_company_and_when_it_goes`. Test:
`supabase/tests/company-closure.test.mjs`. `docs/data-lifecycle.md`
records the closure decision.

- **Ownership:**
  - `transfer_company_ownership()` hands the company only to a member in
    good standing (decided).
  - The new owner becomes an admin with every switch on. The former owner
    stays an admin.
  - `guard_company_update()` refuses any other way of moving `owner_id`.
  - Recorded in the activity log.
  - The doc's emailed confirmation code was not built. The owner confirms in
    a dialog.
  - Both people are emailed (`company_ownership_transferred`, transactional).
    The new owner is told what they now hold. The former owner is told it
    was done, and to contact us if it was not them.
- **Deletion, 14 days (decided):**
  - `request_company_deletion()` is for the owner alone. It runs at once:
    - `company_suspended()` answers true, so the public page hides it.
    - Hiring pauses.
    - Live listings close, and listings in review go back to draft.
    - Nothing can be submitted (`company_closing`).
  - `cancel_company_deletion()` brings it back. Listings stay closed and
    hiring stays paused until reopened on purpose.
  - `close_due_companies()` runs nightly, from pg_cron and the lifecycle
    route. After 14 days it:
    1. Writes each applicant's record.
    2. Deletes the applications (no withdrawal notices).
    3. Deletes the company. Its logo, papers and CVs are queued by the
       existing release triggers.
  - A company with orders is **closed** instead of deleted, because a
    payment is the platform's record (migration 353). Its team (all but the
    owner, whom the membership guard keeps) and its listings go, its
    profile is emptied, and the row stays.
- **Purging (decided: candidates keep a record):**
  - `companies.purge_closed_after_days` is 30, 90, 180 or 365. The app
    offers a year from applying (the default), six months, three months or
    a month.
  - Applications to listings ended longer than that are cleared nightly.
  - `jobs.ended_at` is new, stamped by a trigger, because nothing recorded
    when a listing ended.
- **The candidate's record:** `application_records`, which only they read.
  It holds the listing's title, the company's name, when they applied and
  the last status. It is kept a year from applying, as the application
  would have been. «طلبات لم تعد عند الشركة» is shown under All and Ended in
  the applications tab.
- **Website:**
  - Actions `transferCompanyOwnership`, `requestCompanyDeletion` (the
    company's name typed back), `cancelCompanyDeletion` and
    `setApplicationPurge`.
  - `company_closing` is mapped for listings.
  - The website's settings page for all of this comes later.
- **App:** «حساب الشركة» on the company page.
  - Any admin sets the purge period.
  - The owner hands over, deletes (a sheet that says what happens and asks
    for the name), or cancels while it goes.
  - A closed company says so.

Not built from 07: 7b (branches) and default screening questions, which
need their own design doc.

