# 01 · Bulk actions in the pipeline

Board: **PipelineBulk**. On the applicant inbox: select several, then move
them to a stage, send one saved reply to all, or decline with a reason.

## What exists

- `setApplicationStatus` (website action) moves **one** application. It
  checks `from` (the stage the card showed), writes `application_events`
  (migration 42) and the decision note, and sends the candidate the stage
  email and push.
- The inbox (`/employer/applicants`) reads 25 at a time and stamps them seen
  (`markApplicantsSeen`, capped at `APPLICANTS_CAP`).
- Saved replies are stored **on the phone only**
  (`mobile/src/components/employer/saved-replies.tsx`), and WhatsApp opens
  one chat at a time. There is no server-side send.

## Proposal

### Schema (migration `37x_moving_many_at_once`)

No new table. Add one function that moves several applications in one
transaction, with the same rules as a single move:

```sql
create or replace function public.set_application_statuses(
  p_ids uuid[],            -- at most 50
  p_from application_status,
  p_to application_status,
  p_note text default null,  -- the decline reason, cleaned like decision_note
  p_reason text default null -- a key from the decline-reason list (below)
) returns table (id uuid, outcome text)  -- 'moved' | 'moved_already' | 'forbidden'
language plpgsql security invoker ...
```

- `security invoker`: RLS on `applications` already limits a member to the
  company's own applications. Each id that is not at `p_from` comes back as
  `moved_already` rather than being overwritten, like the single move.
- One `application_events` row per application. One row in `audit_log` per
  batch, with the count.
- Rate limit: `limit_for('applications:bulk:user:hour', 3600, 20)` batches.

rollback: `drop function public.set_application_statuses(...)`. safety:
additive.

### Decline reasons

**Decided:** the employer chooses, with a tick, whether the candidate sees
the reason. This is built for the single move: `setApplicationStatus`
takes `shareReason`, and absent means yes. Unticked, the reason is not
written to `decision_note` (the candidate's row) but kept as the company's
note on the application (`application_notes`, migration 58). The answer
says `reasonKept: false` if that note could not be written; the move
stands either way. The app's applicant card has the tick. The website's
card still shares, as before. Bulk declines will send the same flag for the
whole batch.

A short fixed list, stored as a key on the event (`application_events.reason_key`,
a new nullable text column with a check constraint). Proposed keys:
`experience`, `area`, `track`, `filled`, `other`. The candidate sees the
reason only when the tick is on.

### Website action

`setApplicationStatuses({ ids, from, to, note?, reasonKey?, notify })`, which:
calls the function, then publishes one `APPLICATION_STATUS_CHANGED` event
per moved application (the same event `setApplicationStatus` publishes
today), so emails and pushes go out exactly as for a single move. It returns `{ moved, movedAlready, forbidden }`
counts.

### One saved reply to all

WhatsApp cannot be sent from a server without the WhatsApp Business API. So
"one saved reply to all" is either:

1. **(Recommended)** an in-platform message: the reply goes as the stage
   email, with its text, to each selected candidate. This needs 06 (shared
   saved replies) for the text and nothing else.
2. A WhatsApp Business API integration. That is a separate decision (cost,
   templates approved by Meta, opt-in). Out of scope here.

### App

- The inbox gets a select mode: long-press or a «تحديد» button, a check per
  card, and a bar at the foot with «نقل إلى…», «رد واحد للجميع» and «اعتذار».
- A confirmation sheet names the count and the stage, plus the reason
  picker when declining.
- After the batch: a toast with the counts, and the cards that had
  `moved_already` stay selected with a note.

### Analytics

`applicants_bulk_moved { to: stage, count_band: '2-5'|'6-20'|'21-50' }`, a
new event in the website vocabulary, written in its own commit.

## Decisions needed

1. Is the reasons list above right? (Visibility is decided: the tick.)
2. Is the saved-reply bulk send email-only, as recommended?
