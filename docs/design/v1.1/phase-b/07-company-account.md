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
