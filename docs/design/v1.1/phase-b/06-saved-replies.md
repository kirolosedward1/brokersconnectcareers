# 06 · Saved replies with variables and channels, team-wide or personal

Board: **SavedReplies**.

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
