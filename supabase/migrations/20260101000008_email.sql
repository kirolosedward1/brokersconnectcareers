-- =============================================================================
-- 08 — Email notification preferences
--
-- Three switches rather than one, because the messages are not equivalent:
-- somebody who wants to know an employer moved their application may still not
-- want a weekly digest, and turning off the digest should not silently also
-- turn off "you have a new applicant".
--
-- All default to true. Every one of these is a message the recipient asked for
-- by using the product — applying, posting, being moderated — not a broadcast.
-- =============================================================================

alter table profiles
  add column notify_applications boolean not null default true,
  add column notify_status       boolean not null default true,
  add column notify_digest       boolean not null default true;

comment on column profiles.notify_applications is
  'Employer: a candidate applied to one of my jobs.';
comment on column profiles.notify_status is
  'Candidate: an employer moved my application, or moderation decided on my job.';
comment on column profiles.notify_digest is
  'Candidate: the weekly roundup of matching roles.';

-- ---------------------------------------------------------------------------
-- Unsubscribe token
--
-- An unsubscribe link has to work from an email client, where there is no
-- session and no cookie — so it cannot be authenticated the way the rest of
-- the app is. The token is the credential.
--
-- It is deliberately a separate value from the user id: the id appears in URLs
-- all over the product, and reusing it here would mean anyone who had ever
-- seen a profile link could switch off that person's notifications. This is
-- random, unguessable, and grants exactly one power — turning something off.
-- ---------------------------------------------------------------------------

alter table profiles
  add column unsubscribe_token uuid not null default gen_random_uuid();

create unique index profiles_unsubscribe_token_idx on profiles (unsubscribe_token);

-- Not readable by other users: the existing profiles policies already scope
-- selects, and nothing here widens them. The unsubscribe endpoint reads this
-- with the service role, having authenticated the request with the token
-- itself.

-- ---------------------------------------------------------------------------
-- The owner may change their own preferences, and nothing else here.
--
-- guard_profile_update already blocks role escalation. The token is added to
-- the same guard so a user cannot rotate someone else's — or their own, which
-- would silently break every unsubscribe link already sitting in an inbox.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role changes are an admin action';
  end if;

  if new.unsubscribe_token is distinct from old.unsubscribe_token then
    raise exception 'unsubscribe_token is not user-writable';
  end if;

  return new;
end;
$$;
