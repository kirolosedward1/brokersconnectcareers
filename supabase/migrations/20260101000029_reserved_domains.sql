-- =============================================================================
-- 29 — Never send to an address that cannot exist
--
-- The seed creates demo accounts at demo.test. The first nightly batch would
-- have mailed three of them, and every one would have hard bounced, because
-- .test is reserved by RFC 2606 precisely so that it can never resolve.
--
-- Three bounces is not a small thing on a domain verified this morning. Bounce
-- rate is the number every receiving provider scores a new sender on, and it
-- is shared across everything the domain sends — so a batch of undeliverable
-- seed rows is a way to push this platform's password resets into spam before
-- a single real user has signed up.
--
-- Enforced here rather than by deleting the demo accounts, because the seed
-- recreates them, and rather than in TypeScript, because claim_email is the
-- one place every message already passes through. Recorded as `suppressed`
-- rather than dropped, so the admin view shows what was refused and why — a
-- message that vanishes with no row is the failure mode this whole table
-- exists to remove.
--
-- The list is exactly RFC 2606 and RFC 6761: these are reserved forever and
-- can never be delegated, so nothing legitimate is ever caught by it.
-- =============================================================================

create or replace function public.is_undeliverable_domain(p_email text)
returns boolean
language sql
immutable
as $$
  select lower(split_part(p_email, '@', 2)) in ('test', 'invalid', 'example', 'localhost')
      or lower(split_part(p_email, '@', 2)) like '%.test'
      or lower(split_part(p_email, '@', 2)) like '%.invalid'
      or lower(split_part(p_email, '@', 2)) like '%.example'
      or lower(split_part(p_email, '@', 2)) like '%.localhost'
      or lower(split_part(p_email, '@', 2)) in ('example.com', 'example.net', 'example.org');
$$;

create or replace function public.claim_email(
  p_dedupe_key  text,
  p_template    text,
  p_recipient   text,
  p_user_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_reason text;
begin
  -- Two ways an address is off-limits, recorded the same way: one the provider
  -- told us about, one that could never have worked.
  if public.is_undeliverable_domain(p_recipient) then
    v_reason := 'reserved domain, cannot receive mail';
  elsif exists (select 1 from email_suppressions where email = lower(p_recipient)) then
    v_reason := 'address is suppressed';
  end if;

  if v_reason is not null then
    insert into email_log (dedupe_key, template, recipient, user_id, entity_type, entity_id, status, error)
    values (p_dedupe_key, p_template, p_recipient, p_user_id, p_entity_type, p_entity_id,
            'suppressed', v_reason)
    on conflict (dedupe_key) do nothing;
    return null;
  end if;

  insert into email_log (dedupe_key, template, recipient, user_id, entity_type, entity_id)
  values (p_dedupe_key, p_template, p_recipient, p_user_id, p_entity_type, p_entity_id)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_email(text, text, text, uuid, text, uuid) from public, anon, authenticated;
