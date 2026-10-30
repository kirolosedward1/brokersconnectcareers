# 06 · Saved replies with variables and channels, team-wide or personal

Board: **SavedReplies**.

## Built (2026-10-30)

- **Migration 374, `saved_replies`.**
  - A reply belongs to the whole team (`person_id` null) or to one person.
  - Its channel is WhatsApp or email.
  - Any member reads the team's replies and their own.
  - Anyone writes their own; only an admin writes the team's.
  - Test: `supabase/tests/saved-replies.test.mjs`.
- **Website actions:** `saveReply` (an edit is matched on its version) and
  `deleteReply`. Limits: 50 team replies, and 30 of their own for each person.
- **Variables:** `{name}`, `{first_name}`, `{job}`, `{company}` and
  `{stage}`, kept in `src/lib/replies.ts`, which the website and the app
  share. A reply with anything else in braces is refused, with the unknown
  words named. The phone fills WhatsApp replies; the email fills email
  replies per applicant.
- **App:**
  - The replies sheet shows the team's replies and the person's own.
  - A WhatsApp reply opens WhatsApp. An email reply is sent through
    `messageApplicants`.
  - A new reply chooses its channel. Admins can also make it the whole team's.
  - Replies still on the phone are offered once, «انقلها إلى حسابي», and
    cleared once kept.
  - The bulk email sheet offers the saved email replies.

The column is named `person_id`, not `owner_id` as sketched below, so it
cannot be mistaken for the company owner. Reordering replies is not built.

## What exists

Saved replies live **on the phone**, per person
(`mobile/src/components/employer/saved-replies.tsx`). They open WhatsApp
with `{name}` and `{job}` filled in. Nothing is on the server, so a team
cannot share them and a new phone starts empty.

## Proposal

### Schema (migration `37x_replies_a_team_keeps`)

```sql
create table saved_replies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  owner_id    uuid references profiles(id) on delete cascade, -- null: team-wide
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null check (char_length(body) between 1 and 1000),
  channel     text not null default 'whatsapp' check (channel in ('whatsapp','email')),
  stage       application_status,      -- offered first on this stage
  sort_order  int not null default 0,
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

RLS: members read team-wide replies (`owner_id is null`) and their own.
Owners and admins write team-wide ones, and everyone writes their own.

Variables, replaced on the phone (WhatsApp) or the server (email), from a
fixed list so no field leaks: `{name}`, `{first_name}`, `{job}`,
`{company}`, `{stage}`. An unknown `{…}` is refused on save.

### Website actions

`saveReply`, `deleteReply`, `reorderReplies`. The app's local replies are
offered for upload once, on first open after the update («انقل ردودك
المحفوظة إلى حسابك»), then the local store is cleared.

### Channels

`whatsapp` opens WhatsApp with the text, as today. `email` sends through the
platform's stage email (the bulk case in 01). A WhatsApp Business API send
is out of scope (see 01).

## Decisions (2026-10-30)

1. Email is a reply channel: **yes**.
