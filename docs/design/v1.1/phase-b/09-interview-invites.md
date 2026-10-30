# 09 · Interview invites

Boards: **EmployerHome** («مقابلتان اليوم»), **ApplicationDetail**. A
company invites a candidate to an interview at a time. The candidate sees
it, and can accept or propose another time. Today's interviews show on the
employer's Home.

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

## Decisions needed

1. Calendar export (a native module and a new build): now or later?
2. Times in Cairo only? Recommended: yes, as everywhere else.
