# 03 · Team roles, scopes per listing and branch, reveal caps, spend permission

Boards: **TeamRoles**, **TeamInvite**, **MemberDetail**.

## Decided and built

**A team is at most five people, the owner included.** Migration 371
(`company_team_cap`) refuses a sixth member with `team_full`, whichever door
adds them. It locks the company row while counting. A team already larger
keeps everybody. `addCompanyMember` answers `team_full`, the website's form
and the app say so, and the app shows «الفريق: N من 5» and replaces the add
form with that sentence when the team is full. Test:
`supabase/tests/team-cap.test.mjs`.

Reveals keep today's limits (per person per hour and day, per company per
day). There is no monthly balance and no per-member cap.

## Built (2026-10-30): switches per member

- **Migration 376, `what_each_member_may_do`.**
  - Adds `can_post`, `can_reveal` and `can_spend` to `company_members`.
    Posting and revealing default to on; spending is on for admins and off
    for recruiters, as only admins could buy before.
  - `member_can(company, permission)` answers for the caller. The owner may
    always do all three, whatever their row says.
  - `reveal_agent_contact` (restated from 304) refuses with a new status,
    `not_permitted`, before counting anything.
  - Test: `supabase/tests/member-permissions.test.mjs`.
- **Website actions:**
  - `saveJob` checks `post`. `transitionJob` checks it when the listing goes
    to review (submitting and reopening).
  - `startCheckout` checks `spend`.
  - `revealAgentContact` answers `not_permitted`.
  - New `updateMemberPermissions({ userId, canPost, canReveal, canSpend })`
    is for admins, and never changes the owner.
  - `addCompanyMember` gives a new admin `can_spend`.
- **App:**
  - Under each member on the team card, a line says what the company keeps
    them from doing.
  - An admin opens a sheet of three switches for anyone but the owner. Each
    switch applies as it is turned, and is put back if the website refuses.
  - The job wizard, the listing's status actions and the contact reveal say
    «لا تسمح لك شركتك…» when refused.
- **Not built:**
  - Listing scopes, branches and the per-member reveal cap: the allowance
    follows the company's plan (decision 3), which waits for 08.
  - The switches on the website's team page come later, with the decline
    tick.

## What exists

- A company has one owner (`companies.owner_id`) and members in
  `company_members` with `CompanyMemberRole = 'admin' | 'recruiter'`.
  Invitations and removal are website actions (`team-settings.tsx` in the
  app).
- Contact reveals are limited **per person per hour and day, and per company
  per day** (`reveal_agent_contact`, migration 304: 30 an hour, 120 a day per
  person, 300 a day per company). There is no monthly balance.
- Spending happens on the website (`startCheckout`). Any owner or admin may
  start one.

## Proposal

### Roles

Keep two stored roles and add permissions as columns, not more role names,
so a company can shape a member without a role explosion:

```sql
alter table company_members
  add column can_post        boolean not null default true,
  add column can_reveal      boolean not null default true,
  add column can_spend       boolean not null default false,
  add column reveal_cap_month int check (reveal_cap_month between 0 and 1000),  -- null: no cap of its own
  add column listing_scope   text not null default 'all' check (listing_scope in ('all','assigned')),
  add column branch_id       bigint references company_branches(id) on delete set null;
```

`company_branches` comes from 07 (company account). Until 07 lands, the
scope is `all` or `assigned` (listings assigned in `job_assignees`, below).

```sql
create table job_assignees (
  job_id    uuid not null references jobs(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  primary key (job_id, member_id)
);
```

### Enforcement (in the database, not the screens)

- `applications` select policy for members with `listing_scope = 'assigned'`:
  only applications to assigned jobs. The owner and admins always see all.
- `reveal_agent_contact`: refuse with `status = 'forbidden'` when
  `can_reveal` is false, and with a new status `'cap_reached'` when the
  member's reveals this Cairo month reach `reveal_cap_month`. The hourly and
  daily limits stay as they are. **Decision needed:** the board's "monthly
  reveal caps" read like a balance. Is a cap per member enough, or does the
  product want a paid reveal balance? A paid balance belongs to 08.
- `startCheckout` checks `can_spend` (owner always true).
- `saveJob` and `transitionJob` check `can_post`.

rollback: drop the columns, drop `job_assignees`, restate the policies and
`reveal_agent_contact` from 304/344. safety: additive defaults keep today's
behaviour for every existing member.

### Website actions

`updateMemberPermissions({ memberId, canPost, canReveal, canSpend, revealCapMonth, listingScope, branchId })`
(owner or admin only, and never on the owner), plus
`assignListing({ jobId, memberIds })`.

### App

TeamRoles (a matrix of the permissions above), TeamInvite (the same choices
at invite time) and MemberDetail (a member's permissions and their activity
from 04).

## Decisions (2026-10-30)

1. Permissions are **switches per member** (can post, can reveal, can spend),
   not named roles.
2. A team is at most five people (built, migration 371).
3. **How many contacts a company may reveal depends on its plan.** The
   allowance belongs to the company's plan, not to each member. This waits
   for the plan definitions (08, subscriptions later). Until then, reveals
   keep their hourly and daily limits.
