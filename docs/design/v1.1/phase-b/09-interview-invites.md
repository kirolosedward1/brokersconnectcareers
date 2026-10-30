# 09 · Interview invites

Boards: **EmployerHome** («مقابلتان اليوم»), **ApplicationDetail**. A
company invites a candidate to an interview at a time. The candidate sees
it, and can accept or propose another time. Today's interviews show on the
employer's Home.

## Built (2026-10-30)

- **Database:** migrations 372 (the two notification kinds) and 373 (the
  `interview_invites` table, its policies, `answer_interview()`, and the
  bell for both sides). Both kinds are pushed under the applications switch.
  Test: `supabase/tests/interviews.test.mjs`.
- **Website actions:** `inviteToInterview`, `cancelInterview`,
  `acceptProposedTime` and `answerInterview`, all in the mobile contract.
  - One invitation stands per application, so a new one replaces the old.
    That is how the company changes the time.
  - An invitation moves the application to «مقابلة» if it was before that
    stage, which sends the stage's existing email.
- **App, company side:**
  - «دعوة لمقابلة» on the applicant card opens a sheet with a day, a time in
    Cairo time, the duration, the mode, the place and a note.
  - The standing invitation shows when, how and its status, with «اعتمد
    الموعد المقترح», «غيّر الموعد» and «ألغِ الدعوة».
  - Home lists «مقابلات اليوم» with names and times.
- **App, candidate side:** the invitation sits on the application, with
  «أقبل الموعد», «أقترح موعدًا آخر» and «أعتذر», and then the answer given.
- **Notifications:** bell and push wording on the website and in the app.
- **Analytics:** `interview_invited` and `interview_answered`.

Not built yet:
- A dedicated invitation email. The candidate gets the bell, the push, and
  the stage email.
- The reminder two hours before.
- Interview screens on the website, beyond the bell.
- Calendar export (decided: later).

## What exists

`interview` is a stage (`ApplicationStatus`). Moving an applicant there
emails the candidate. There is no time, place or answer.

## Proposal (migration `37x_a_time_both_sides_agree`)

```sql
create table interview_invites (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  starts_at      timestamptz not null,
  minutes        int not null default 30 check (minutes between 10 and 240),
  mode           text not null check (mode in ('office','phone','video')),
  place          text,          -- the address for office, a link for video
  note           text,
  status         text not null default 'proposed'
                 check (status in ('proposed','accepted','declined','counter','cancelled','done')),
  counter_starts_at timestamptz,  -- the candidate's proposed other time
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on interview_invites (application_id, starts_at desc);
```

RLS: the company's members read and write their applications' invites. The
candidate reads their own and may change only `status` (to `accepted`,
`declined` or `counter`) and `counter_starts_at`, through a definer
function `answer_interview(p_id, p_answer, p_counter)` rather than a broad
update policy.

### Website actions and notifications

- `inviteToInterview({ applicationId, startsAt, minutes, mode, place, note })`
  moves the application to `interview` if it is not there yet, and
  publishes `INTERVIEW_INVITED` (email and push to the candidate).
- `answerInterview({ id, answer, counterStartsAt? })` publishes
  `INTERVIEW_ANSWERED` (to the company's members, under the push
  "applications" category from migration 335).
- `cancelInterview({ id })`.
- A reminder push two hours before, for both sides, through the existing
  push queue (`enqueue_push`) with the quiet hours respected.

### App

- Candidate: the application detail shows the invite with «أقبل»,
  «أقترح وقتًا آخر» and «أعتذر», and adds it to the calendar (`expo-calendar`
  needs a native build and a permission string).
- Employer: the Home queue (A5) gains «مقابلات اليوم» with names and times
  in `Num`, and the applicant card shows the next interview.

### Analytics

`interview_invited {}`, `interview_answered { answer }`. These are new
events in the vocabulary, written in a separate commit.

## Decisions (2026-10-30)

1. Calendar export: **later** (no new native build for now).
2. Times are **Cairo time**.
