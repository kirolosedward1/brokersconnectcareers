# 02 · Shared candidate notes and «تقدّم من قبل»

Boards: **CandidateHistory**, **ApplicantReview**. A company sees its earlier
dealings with a candidate on every application they send: earlier
applications to its other listings, how each one ended, and notes the team
wrote about the person (not about one application).

## What exists

- `application_notes` (migration 58) holds notes **per application**. The
  candidate cannot read them, and members of the company can. The note's
  own table keeps them away from the candidate's select policy on
  `applications`.
- The history signal exists already: a company can read every application
  to its own listings (RLS on `applications`), so "this person applied to
  us before" and how it ended can be computed from rows the company may
  already see. Nothing needs to be shared across companies, and nothing will
  be.

## Proposal

### Schema (migration `37x_what_a_company_knows_of_a_candidate`)

```sql
create table company_candidate_notes (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references companies(id) on delete cascade,
  candidate_id  uuid not null references profiles(id) on delete cascade,
  author_id     uuid references profiles(id) on delete set null,
  body          text not null check (char_length(body) between 1 and 2000),
  idempotency_key text,
  created_at    timestamptz not null default now(),
  unique (company_id, idempotency_key)
);
create index on company_candidate_notes (company_id, candidate_id, created_at desc);
```

RLS:
- select: `company_id = my_company_id()` **and** the candidate has applied to
  one of the company's listings (an `exists` on `applications`). A company
  cannot keep notes on people who never applied to it.
- insert: same, with `author_id = auth.uid()`.
- delete: the author, or the company's owner or admin.
- No policy for the candidate. They never read these.

A function for the history, so the app does not read every row:

```sql
create or replace function public.candidate_history_here(p_application_id uuid)
returns table (application_id uuid, job_title_ar text, job_title_en text,
               status application_status, created_at timestamptz, decided_at timestamptz)
language sql stable security invoker ...
-- The candidate's other applications to the caller's company, newest first, at most 20.
```

`security invoker` keeps RLS in charge. rollback: drop the table and the
function. safety: additive. Deleting an account cascades its notes. The data
export (`/api/account/export`) does **not** include notes other people wrote
about the person. **Decision needed:** legal review of that choice under
Egypt's data protection law (Law 151 of 2020). The export may have to say
that such notes exist.

### Website actions

- `saveCandidateNote({ applicationId, body, key })`: the candidate is
  resolved from the application, so the client never names a person.
- `deleteCandidateNote({ id })`.

### App

- The applicant card and the review sheet get a «تقدّم من قبل» line when the
  history is not empty: count, last outcome and date. It opens the list.
- The notes panel gets two tabs: «هذا الطلب» (today's per-application notes)
  and «عن المرشّح» (the new shared notes).

### Analytics

None new. These are working notes, not a funnel.

## Decisions (2026-10-30)

1. Shared notes are readable by the **whole company**.
2. The data export **does not mention** notes others wrote.
