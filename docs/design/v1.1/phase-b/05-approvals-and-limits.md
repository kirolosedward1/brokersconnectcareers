# 05 · Approvals and limits

Board: **ApprovalsLimits**. A company sets which actions need the owner's (or
an admin's) approval: publishing a listing, changing a listing's pay,
declining applicants, spending. It also sets a monthly spend ceiling,
enforced two-factor sign-in for members, session expiry, and whether only
admins may download CVs.

## What exists

- Listings already go through **platform** moderation (`pending_review`,
  then a moderator publishes). Company-internal approval would be a second
  gate before that.
- Two-factor sign-in exists per person (TOTP, `mfa-enrol`), and admins are
  required to use it. Companies cannot require it of their members.
- CV downloads go through `/api/agent-cv` and the applicant CV route, with
  per-person rate limits.

## Proposal

### Schema (migration `37x_a_company_sets_its_own_rules`)

```sql
create table company_policies (
  company_id          uuid primary key references companies(id) on delete cascade,
  approve_pay_change  boolean not null default false,
  approve_decline     boolean not null default false,
  approve_spend       boolean not null default false,
  spend_ceiling_month_egp int check (spend_ceiling_month_egp >= 0),
  require_mfa         boolean not null default false,
  session_days        int check (session_days between 1 and 90),
  cv_admins_only      boolean not null default false,
  updated_at          timestamptz not null default now(),
  version             int not null default 1
);

create table company_approval_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  kind         text not null check (kind in ('publish','pay_change','decline','spend')),
  subject_id   text not null,          -- job id, application ids, order key
  payload      jsonb not null,         -- what would happen if approved
  requested_by uuid not null references profiles(id),
  status       text not null default 'pending' check (status in ('pending','approved','refused','expired')),
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  note         text,
  created_at   timestamptz not null default now()
);
```

RLS: members read their company's policies. Only the owner or admins update
them. Requests are readable by the requester and by the owner and admins.

### Enforcement

- ~~`approve_publish`~~: **dropped (decided).** Platform moderation is the
  only gate before publishing, and the column is removed from the sketch.
- `approve_pay_change`: `saveJob` refuses a pay change by a non-admin on a
  live listing and writes a request instead.
- `approve_decline`: decline moves (single and bulk, 01) write requests.
- `approve_spend` and `spend_ceiling_month_egp`: checked in `startCheckout`
  against the month's paid `orders`.
- `require_mfa`: `getViewer` reports `mfaRequired` for members of the
  company. The app's existing MFA gate (`mfa-enrol`, used for admins) asks
  them to enrol.
- `session_days`: a refresh older than that is refused by the website's
  mobile token check. **Decision needed:** this can only be approximate
  (Supabase refresh tokens). It may be better dropped.
- `cv_admins_only`: the CV routes refuse members who are not admins.

### Website actions

`saveCompanyPolicies`, `decideApprovalRequest({ id, approve, note })`, and
an `approvalRequests` read for the owner's queue. The employer Home queue
(already built in A5) gets one more row: «طلبات بانتظار موافقتك».

## Decisions (2026-10-30)

1. Company-internal publish approval: **no**.
2. Automatic sign-out after N days: **dropped**. There is no auto sign-out.

## Built (2026-10-30)

Migration 380, `a_company_sets_its_own_rules`. Test:
`supabase/tests/company-rules.test.mjs`. Every rule is kept by the
database, so the website and the app are held alike.

- **`company_policies`** holds one row of rules per company. Admins write
  it; every member reads it, even one a rule shuts out.
  `company_rules()` answers the caller's company, and whether this session
  meets a required second factor.
- **Declines approved by an admin.**
  - A non-admin member's move to «مرفوض» is refused with
    `decline_needs_approval`.
  - `setApplicationStatus` then writes a `company_approval_requests` row,
    one waiting per applicant, and answers `pendingApproval`. The bulk
    count says how many are waiting.
- **Pay changes on a live listing approved by an admin.**
  - A non-admin's change to any pay column of an active listing is refused
    with `pay_change_needs_approval`.
  - `saveJob` saves the rest of the edit, asks for the pay, and answers
    `pendingApproval`.
- **`decideApprovalRequest`.**
  - The admin approves, and the thing is done now, as them. A decline goes
    through the ordinary move (the candidate is told as usual). The pay is
    written to the listing.
  - If a colleague moved the applicant since, the request is marked
    `expired` and nothing is done.
- **Monthly spending ceiling.** `startCheckout` adds this Cairo month's paid
  orders to the pack and refuses with `spend_ceiling` past the ceiling.
  Whether a member may spend at all is 03's switch, so `approve_spend` was
  not needed.
- **A second factor for the whole team.**
  - `owns_company()`, `is_company_admin()` and `owns_job()` answer false
    for a member whose session is not aal2. Every policy built on them then
    shows that member nothing.
  - Turning it on is refused from a session that has not itself used a
    second factor (`mfa_required_to_require`), so an admin cannot lock
    themselves out.
  - The app says why, on Home and the company page, with the way through
    (verify a code, or set an authenticator up).
- **CVs for admins only.** `may_read_application_cv()`; `/api/cv` answers
  403 `cv_admins_only`.
- **App:**
  - «قواعد الفريق» on the company page, for admins.
  - «طلبات الموافقة» (`/employer/approvals`): admins approve or refuse;
    anybody else sees their own asks.
  - The queue appears on Home for admins.
  - A decline or a pay change that waits says so.
- **Not built:**
  - Publish approval and automatic sign-out (dropped, as decided).
  - The website's settings page and queue come later. The website's own
    forms show the generic line for the new refusals.

