# Forms, uploads and saved progress — audit, October 2026

What was looked at, what was already right, and what changed. The point of
writing it down is the second list: most of this was already sound, and the
next person should not re-derive why.

## Uploads: already sound, verified

| Upload | Path | What checks it |
|---|---|---|
| Profile photo, company logo | `uploadImage` (`lib/actions/uploads.ts`) | Server reads the bytes, sniffs the format (`lib/security/magic.ts`), decodes and re-encodes to WebP (drops EXIF/GPS and trailing data), 2 MB cap, 30 a day per account. Logo: the caller must be the company's admin, asked of the database. |
| CV with an application | browser → `cvs` bucket, then `applyToJob` | Storage RLS confines the browser to `<own id>/`; the action re-checks the path shape (`isOwnedPath`, no `..`), sniffs the first 4 KB through a signed URL, enforces 10 MB, removes a refused file unless rows already point at it (`cv-in-use.ts`). |
| CV on the directory profile | browser → `cvs`, then `saveAgentProfile` | Same as above. |
| Commercial register, tax card | browser → `company-documents`, then `recordCompanyDocument` | Private bucket under the company's id; same path, size and byte checks; read back only through short-lived signed URLs minted after an authorisation check (`lib/storage.ts`). |

Orphans: every client uploader removes its file when the server refuses the
record, except when no answer came back (the record may exist); the lifecycle
sweep clears anything unreferenced after a day. `scripts/security-libs.test.mjs`
and `scripts/cv-in-use.test.mjs` pin this.

Failures already handled everywhere: a dropped connection is a result, not an
error boundary (`lib/reach.ts`); an expired session goes to sign-in and back
(`lib/session-expired.ts`); the job wizard is idempotent across a lost answer
and refuses a stale overwrite (`version`).

## What changed

**Typed work survives a closed tab, a lost connection and a sign-in.**
Nothing was kept anywhere but React state, and `recoverExpiredSession` — doing
the right thing — sent people to sign in and back to an empty form.
`lib/form-draft.ts` keeps a draft in `localStorage`; `lib/use-form-draft.ts`
wires a form to it; `components/ui/draft-notice.tsx` says when one was put back
and offers to start over. Used by:

- the job wizard — every field, the chips and the step. A draft typed over an
  older `version` of the listing is *offered*, not applied, so a colleague's
  save is never silently undone;
- the apply form — name, number, experience, note (never the CV);
- onboarding — the person's and the company's details (never the consent tick).

Kept under the account and record, for seven days at most, removed on a
successful send, on "start over" and on every sign-out. Listed on the cookie
page; `scripts/legal.test.mjs` holds the code to that listing.

**Upload failures say what went wrong.** A Storage refusal used to be "try
again" whatever it was. `lib/upload-failure.ts` sorts it into too large, wrong
type, no connection, refused by policy or other; `lib/use-upload-failure.ts`
turns that into words, and for a policy refusal checks whether the session
ended (→ sign in, draft kept) or the account may not upload (→ says so). Avatar
and logo uploads now name their daily limit instead of "try again".

**A listing that closed while the form was open is named.** `applyToJob`
answered an RLS refusal with the raw Postgres message, which the form showed as
"try again" — advice that can never work. It now checks the listing and answers
`not_open`; web and app both say the listing stopped taking applications. No
database text reaches the browser from this action any more.

## Tests

- `pnpm test:drafts` (`scripts/form-draft.test.mjs`): keys per account,
  expiry, unreadable and future-dated drafts, sign-out, storage that is full or
  blocked, the size ceiling, and every upload-failure shape.
- The hook's effect sequencing (restore after hydration, flush on `pagehide`,
  the held-back offer, StrictMode's effect replay) was exercised in Chromium
  against a harness; the offer was found being deleted by the replay and fixed
  before this landed.

## The app

The app asked before Back threw typed work away (`use-leave-guard.ts`), but
iOS ending it in the background asked nobody. `mobile/src/lib/kept-draft.ts`
and `use-kept-draft.ts` are the website's drafts on AsyncStorage — the same
key shape, the same week, the same rules — written as typing settles and at
once when the app leaves the foreground. Used by the job wizard (fields and
step) and the apply screen (name, number, band, note; never the CV). A draft
typed over an older version of a listing, or found after typing had begun, is
offered rather than poured in. It goes on sending, on "start over", on
discarding at the leave guard, and on any sign-out (`push-bridge.tsx`).
`mobile/tests/kept-draft.test.tsx`, the wizard's and the apply screen's own
tests cover it.

A stale save in the app keeps the original "this listing changed, reload"
wording rather than the website's "your changes are kept": on the phone the
way to the new version is leaving the wizard, and leaving asks to discard.

## Review, 2026-10-22

A second pass, with an independent reviewer and a browser walkthrough of the
production build against a local Supabase stack, found and fixed:

- An offered draft was thrown away by moving to another wizard step to look
  at the current version first. Both hooks take a `typed` projection now, and
  only a change to what was typed answers an offer.
- Deleting the account on the website (settings, or leaving onboarding) left
  the account's drafts in the browser. Both clear them;
  `scripts/form-draft.test.mjs` holds every client sign-out and deletion path
  to calling `forgetDrafts()`.
- The app dropped a draft the moment it put it back and wrote it again 400 ms
  later, so merely opening a form restarted its week.
- The app's apply screen restored a note behind the folded one-tap summary,
  under a notice saying it had been put back.

Open, for a decision: the app clears drafts whenever a session ends,
including one revoked elsewhere, where the website keeps them through a lapsed
session so the person can sign in and carry on. The company and consultant
profile forms (web and app) keep no draft; they are single-page edits of a
saved record, and the same hooks would serve them.

## Left as it is, on purpose

- Nineteen action branches (`account.ts`, `agent-profile.ts`, `admin.ts`,
  `saved-searches.ts`, `talent-pool.ts`, `company.ts`, `notifications.ts`,
  the rest of `applications.ts`) still answer an unexpected database error
  with its message. Every expected one is already a code; this is the
  leftover. The app prints the reason in brackets under "we couldn't complete
  that" on purpose (since 2026-10-19), to say what actually failed, so
  turning these into a bare `failed` trades that for tidiness. If it is
  wanted, log the message server-side (`logFailure`) and answer a code.
