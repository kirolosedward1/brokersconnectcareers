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
