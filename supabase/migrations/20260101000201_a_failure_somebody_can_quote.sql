-- =============================================================================
-- 201 — A failure somebody can quote, and somewhere to quote it
--
-- When something broke, the person it broke for saw "مقدرناش نكمّل العملية" and
-- the server wrote one console line to a log that Vercel keeps for an hour. By
-- the time anybody asked, the line was gone, and the only way to learn what
-- had happened was for a developer to reproduce it against production. Support
-- could not answer a single "it didn't work" without one.
--
-- Two tables close that:
--
--   support_events    one row per unexpected failure, keyed by the reference
--                     the reader was shown — BC-7K3M-9QX2 — so the number they
--                     read out is the number an admin searches. Written by the
--                     server when an action fails in a way nobody planned for,
--                     by the browser when the network drops or a page throws,
--                     and by Next's own error hook for anything uncaught.
--
--   support_requests  what somebody sends when they ask for help: the topic,
--                     their words, the reference if they have one, and the
--                     context the platform attaches itself — the account, its
--                     role, the page, the browser, the build — so nobody is
--                     asked "which page were you on?" by a person who could
--                     have been told.
--
-- What neither table ever holds: a password, a token, a query string (this app
-- carries sign-in codes in them), the contents of a CV, a document, or a row's
-- personal fields. Identifiers and codes. The writers below enforce the shapes
-- rather than trusting their callers to.
--
-- Both are written through definer functions callable by anon as well as by
-- signed-in users, on purpose: the failures that most need a reference —
-- signing up, signing in, a confirmation link that will not work — happen to
-- people who are not signed in, and production has no service-role key to
-- write on their behalf. The cost of that openness is paid in limits: a row
-- count per account, a smaller one per address, and a ceiling on the whole
-- signed-out side, so a script can fill neither table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The reference, minted in SQL for rows the database creates itself
--
-- Same alphabet as src/lib/support/reference.ts: Crockford base32, no I, L, O
-- or U. A byte modulo 32 is uniform because 256 is a multiple of 32, and
-- gen_random_uuid() is core Postgres, so this needs no extension.
-- ---------------------------------------------------------------------------

create or replace function public.support_reference()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea := uuid_send(gen_random_uuid());
  v_out      text := '';
begin
  for i in 0..7 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return 'BC-' || substr(v_out, 1, 4) || '-' || substr(v_out, 5, 4);
end;
$$;

revoke execute on function public.support_reference() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- support_events
-- ---------------------------------------------------------------------------

create table if not exists support_events (
  id           bigint generated always as identity primary key,
  -- What the reader was shown. Unique, so a browser re-sending a report it
  -- queued while offline cannot record the same failure twice.
  reference    text not null unique
               check (reference ~ '^BC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  -- 'server' an action or route noticed and refused; 'client' the browser
  -- saw it (a dropped connection, a page that threw); 'exception' nothing
  -- caught it and Next's onRequestError did.
  source       text not null check (source in ('server', 'client', 'exception')),
  -- The subsystem, as the existing log prefixes already name it: apply,
  -- listing, auth, upload, company, cv, render, support…
  area         text not null check (area ~ '^[a-z][a-z_]{1,31}$'),
  -- What did not happen, in the product's words.
  event        text not null check (length(btrim(event)) between 1 and 120),
  -- A Postgres, GoTrue or storage error code, or an HTTP status.
  code         text check (length(code) <= 64),
  -- Next's digest for a thrown error. The browser's row and the server's
  -- 'exception' row for the same throw share it, which is how the page a
  -- reader saw is joined to the stack that produced it.
  digest       text check (length(digest) <= 64),
  -- Set from the session by the writer, never taken from the caller.
  -- `on delete set null`: deleting an account anonymises its failures rather
  -- than keeping them or failing the delete.
  user_id      uuid references auth.users on delete set null,
  -- The role at the moment of failure. 'onboarding' is an account that has
  -- signed in but not yet chosen what it is — a real state with its own bugs.
  role         text check (role in ('candidate', 'employer', 'admin', 'onboarding')),
  route        text check (length(route) <= 200 and route like '/%'),
  -- Identifiers only — a job id, an application id, a status. Bounded so a
  -- careless caller fails loudly instead of filling the table with a row dump.
  detail       jsonb not null default '{}'::jsonb
               check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2048),
  client       text check (length(client) <= 120),
  locale       text check (locale in ('ar', 'en')),
  release      text check (length(release) <= 40),
  occurred_at  timestamptz not null default now()
);

create index if not exists support_events_recent_idx on support_events (occurred_at desc);
create index if not exists support_events_user_idx   on support_events (user_id, occurred_at desc);
create index if not exists support_events_anon_idx   on support_events (occurred_at desc) where user_id is null;
create index if not exists support_events_digest_idx on support_events (digest) where digest is not null;

alter table support_events enable row level security;

-- Admins read. Nobody writes except record_support_event(), which runs as its
-- definer, so the absence of an insert policy is the point.
drop policy if exists support_events_select_admin on support_events;
create policy support_events_select_admin on support_events
  for select using (public.is_admin());

revoke insert, update, delete, truncate on support_events from anon, authenticated;

comment on table support_events is
  'One row per unexpected failure, keyed by the reference the reader saw. Identifiers and codes only; kept 90 days.';

-- ---------------------------------------------------------------------------
-- The one writer
-- ---------------------------------------------------------------------------

create or replace function public.record_support_event(
  p_reference text,
  p_source    text,
  p_area      text,
  p_event     text,
  p_code      text  default null,
  p_route     text  default null,
  p_detail    jsonb default '{}'::jsonb,
  p_digest    text  default null,
  p_client    text  default null,
  p_locale    text  default null,
  p_release   text  default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_role   text;
  v_recent int;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_route  text;
begin
  -- A malformed reference is a bug in this app, not in the reader's request,
  -- and a bug should be loud. Everything else is trimmed to fit rather than
  -- refused: a report about a failure must not itself fail over a long label.
  if p_reference is null
     or p_reference !~ '^BC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' then
    raise exception 'invalid_reference';
  end if;
  if p_source is null or p_source not in ('server', 'client', 'exception') then
    raise exception 'invalid_source';
  end if;
  if p_area is null or lower(p_area) !~ '^[a-z][a-z_]{1,31}$' then
    raise exception 'invalid_area';
  end if;
  if nullif(btrim(p_event), '') is null then
    raise exception 'invalid_event';
  end if;

  /*
    Limits, counted from the rows themselves — migration 19's rule: the table
    is its own ledger, so there is nothing to drift and nothing to clean up.

    Thirty in ten minutes per account is far past anything a person produces
    by using the site, however broken it is. The signed-out side shares one
    ceiling, because it cannot be told apart per person here; when a flood
    reaches it, what stops is signed-out logging, and nothing else.

    Refusing returns false rather than raising. The caller is already in the
    middle of telling somebody that something failed, and the reference it
    shows them is still in the platform log line either way.
  */
  if v_user is not null then
    select count(*) into v_recent
      from support_events
     where user_id = v_user and occurred_at > now() - interval '10 minutes';
    if v_recent >= 30 then
      return false;
    end if;
  else
    select count(*) into v_recent
      from support_events
     where user_id is null and occurred_at > now() - interval '10 minutes';
    if v_recent >= 200 then
      return false;
    end if;
  end if;

  -- Retention on the write, as agent_profile_views does: the crons this
  -- platform has need a key production does not have, so a cron here would be
  -- a promise that never ran. A bounded sweep per insert keeps the table at
  -- ninety days without ever making one insert slow.
  delete from support_events
   where id in (
     select id from support_events
      where occurred_at < now() - interval '90 days'
      order by occurred_at
      limit 50
   );

  if v_user is not null then
    v_role := coalesce((select role::text from profiles where id = v_user), 'onboarding');
  end if;

  if jsonb_typeof(v_detail) <> 'object' then
    v_detail := '{}'::jsonb;
  elsif pg_column_size(v_detail) > 2048 then
    v_detail := jsonb_build_object('truncated', true);
  end if;

  -- The path and nothing after it. The app never sends a query string, and
  -- this makes sure a future caller cannot either.
  v_route := left(split_part(split_part(btrim(p_route), '?', 1), '#', 1), 200);
  if v_route is null or v_route not like '/%' then
    v_route := null;
  end if;

  insert into support_events
    (reference, source, area, event, code, digest, user_id, role, route, detail,
     client, locale, release)
  values (
    p_reference,
    p_source,
    lower(p_area),
    left(btrim(p_event), 120),
    left(nullif(btrim(p_code), ''), 64),
    left(nullif(btrim(p_digest), ''), 64),
    v_user,
    v_role,
    v_route,
    v_detail,
    left(nullif(btrim(p_client), ''), 120),
    case when p_locale in ('ar', 'en') then p_locale end,
    left(nullif(btrim(p_release), ''), 40)
  )
  on conflict (reference) do nothing;

  return found;
end;
$$;

-- Said explicitly, both ways. Supabase grants EXECUTE to anon at creation,
-- so "revoke from public" alone would read as closed and not be; this one is
-- meant to be open, and schema.test.mjs lists it with the reason.
revoke execute on function public.record_support_event(text, text, text, text, text, text, jsonb, text, text, text, text)
  from public;
grant execute on function public.record_support_event(text, text, text, text, text, text, jsonb, text, text, text, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- support_requests
-- ---------------------------------------------------------------------------

create table if not exists support_requests (
  id              uuid primary key default gen_random_uuid(),
  -- The request's own reference, shown on the confirmation and in the reply.
  reference       text not null unique
                  check (reference ~ '^BC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  -- Made once by the form and repeated on every retry, so a send that timed
  -- out after it landed converges on the request it already made.
  request_key     uuid not null unique,
  user_id         uuid references auth.users on delete set null,
  role            text check (role in ('candidate', 'employer', 'admin', 'onboarding')),
  -- Only for somebody who is not signed in: it is the one way to answer them.
  -- A signed-in account is its own contact and its address is never copied
  -- here, where it would outlive a change of address or a deleted account.
  contact_email   text check (contact_email is null or length(contact_email) <= 254),
  topic           text not null check (topic in (
                    'login', 'verification_email', 'apply', 'cv_upload',
                    'company_verification', 'job_not_published',
                    'profile_visibility', 'directory_access', 'other')),
  message         text not null check (length(btrim(message)) between 10 and 2000),
  -- The failure this is about, when there was one.
  error_reference text check (error_reference is null
                  or error_reference ~ '^BC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  route           text check (length(route) <= 200 and route like '/%'),
  client          text check (length(client) <= 120),
  locale          text check (locale in ('ar', 'en')),
  release         text check (length(release) <= 40),
  status          text not null default 'open' check (status in ('open', 'answered', 'closed')),
  reply           text check (length(reply) <= 2000),
  replied_by      uuid references profiles on delete set null,
  replied_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The queue is "open, oldest first"; the reader's own list is "mine, newest
-- first"; the reference search matches either column.
create index if not exists support_requests_queue_idx   on support_requests (status, created_at);
create index if not exists support_requests_user_idx    on support_requests (user_id, created_at desc);
create index if not exists support_requests_contact_idx on support_requests (contact_email, created_at desc)
  where user_id is null;
create index if not exists support_requests_error_idx   on support_requests (error_reference)
  where error_reference is not null;

alter table support_requests enable row level security;

-- Somebody may read their own requests, and the answers to them. That is the
-- only reply channel that works on production today — the mailer has no
-- sender configured — so it is not a nicety.
drop policy if exists support_requests_select_own on support_requests;
create policy support_requests_select_own on support_requests
  for select using (user_id = (select auth.uid()));

drop policy if exists support_requests_select_admin on support_requests;
create policy support_requests_select_admin on support_requests
  for select using (public.is_admin());

revoke insert, update, delete, truncate on support_requests from anon, authenticated;

comment on table support_requests is
  'Help requests with the context the platform attached itself. No passwords, tokens, files or signed-in addresses.';

-- ---------------------------------------------------------------------------
-- Sending one
-- ---------------------------------------------------------------------------

create or replace function public.submit_support_request(
  p_key             uuid,
  p_topic           text,
  p_message         text,
  p_error_reference text default null,
  p_contact_email   text default null,
  p_route           text default null,
  p_client          text default null,
  p_locale          text default null,
  p_release         text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_email    text := nullif(lower(btrim(p_contact_email)), '');
  v_message  text := btrim(coalesce(p_message, ''));
  v_existing support_requests%rowtype;
  v_recent   int;
  v_ref      text;
  v_route    text;
begin
  if p_key is null then
    raise exception 'invalid';
  end if;

  -- The retry first. A request that already landed answers with its own
  -- reference, before any limit is counted — otherwise the retry of the fifth
  -- request of the day would be told it was one too many.
  select * into v_existing from support_requests where request_key = p_key;
  if found then
    if v_existing.user_id is not distinct from v_user
       and (v_user is not null or v_existing.contact_email = v_email) then
      return v_existing.reference;
    end if;
    raise exception 'invalid';
  end if;

  if p_topic is null or p_topic not in (
       'login', 'verification_email', 'apply', 'cv_upload', 'company_verification',
       'job_not_published', 'profile_visibility', 'directory_access', 'other') then
    raise exception 'invalid_topic';
  end if;
  if length(v_message) < 10 then
    raise exception 'message_short';
  end if;
  if length(v_message) > 2000 then
    raise exception 'message_long';
  end if;

  if v_user is null then
    -- Somebody who cannot sign in is exactly who this is for, and an address
    -- is the only way back to them. Checked for shape only: whether it is
    -- theirs is not something a form can know.
    if v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'contact_required';
    end if;

    select count(*) into v_recent
      from support_requests
     where user_id is null and contact_email = v_email
       and created_at > now() - interval '1 day';
    if v_recent >= 3 then
      raise exception 'support_rate_limit';
    end if;

    -- The whole signed-out side, per hour. A person asking for help asks once
    -- or twice; thirty strangers in an hour is somebody's script.
    select count(*) into v_recent
      from support_requests
     where user_id is null and created_at > now() - interval '1 hour';
    if v_recent >= 30 then
      raise exception 'support_rate_limit';
    end if;
  else
    v_email := null;

    select count(*) into v_recent
      from support_requests
     where user_id = v_user and created_at > now() - interval '1 day';
    if v_recent >= 5 then
      raise exception 'support_rate_limit';
    end if;
  end if;

  v_route := left(split_part(split_part(btrim(p_route), '?', 1), '#', 1), 200);
  if v_route is null or v_route not like '/%' then
    v_route := null;
  end if;

  -- Forty random bits will not collide in this platform's lifetime, but the
  -- loop costs nothing and "never" is not a guarantee the constraint accepts.
  for attempt in 1..3 loop
    v_ref := public.support_reference();
    begin
      insert into support_requests
        (reference, request_key, user_id, role, contact_email, topic, message,
         error_reference, route, client, locale, release)
      values (
        v_ref,
        p_key,
        v_user,
        case when v_user is not null
             then coalesce((select role::text from profiles where id = v_user), 'onboarding')
        end,
        v_email,
        p_topic,
        v_message,
        case when p_error_reference ~ '^BC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'
             then p_error_reference end,
        v_route,
        left(nullif(btrim(p_client), ''), 120),
        case when p_locale in ('ar', 'en') then p_locale end,
        left(nullif(btrim(p_release), ''), 40)
      );
      return v_ref;
    exception when unique_violation then
      -- Either the reference collided, which the loop retries, or the same
      -- key arrived twice at once, in which case the other insert's answer
      -- is this one's too.
      select * into v_existing from support_requests where request_key = p_key;
      if found then
        return v_existing.reference;
      end if;
    end;
  end loop;

  raise exception 'unexpected';
end;
$$;

revoke execute on function public.submit_support_request(uuid, text, text, text, text, text, text, text, text)
  from public;
grant execute on function public.submit_support_request(uuid, text, text, text, text, text, text, text, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Answering one
--
-- The reply is written on the request and the bell rings — once. Saving the
-- same answer twice (a double tap, a retry after a timeout) changes nothing
-- and notifies nobody a second time; only a different answer is news.
-- ---------------------------------------------------------------------------

create or replace function public.admin_answer_support_request(
  p_id     uuid,
  p_reply  text,
  p_status text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
  v_row   support_requests%rowtype;
  v_old   text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('open', 'answered', 'closed') then
    raise exception 'invalid';
  end if;
  if v_reply is not null and length(v_reply) > 2000 then
    raise exception 'reply_long';
  end if;
  if p_status = 'answered' and v_reply is null then
    raise exception 'reply_required';
  end if;

  select reply into v_old from support_requests where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  update support_requests
     set status     = p_status,
         reply      = coalesce(v_reply, reply),
         replied_by = case when v_reply is distinct from v_old and v_reply is not null
                           then auth.uid() else replied_by end,
         replied_at = case when v_reply is distinct from v_old and v_reply is not null
                           then now() else replied_at end,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  if v_reply is not null and v_reply is distinct from v_old and v_row.user_id is not null then
    perform public.notify(
      v_row.user_id,
      'support_replied',
      jsonb_build_object(
        'reference', v_row.reference,
        'topic',     v_row.topic,
        'note',      left(v_reply, 280)
      ),
      '/help#requests'
    );
  end if;

  return v_row.status;
end;
$$;

revoke execute on function public.admin_answer_support_request(uuid, text, text) from public, anon;
grant  execute on function public.admin_answer_support_request(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What support may know about one account
--
-- The questions behind almost every ticket, answered from rows the platform
-- already keeps: is the address confirmed, when did we last send a
-- confirmation or a reset, when did they last get in, and with what; is the
-- account suspended; is the company verified and why not; where is the
-- listing; did the application land; what failed for them, and when.
--
-- Found by the address somebody wrote from, the account id, or the WhatsApp
-- number they messaged — exact matches only, one account at a time, so this
-- is a lookup and never a directory.
--
-- What it never returns: the address or the number themselves (the operator
-- typed them; the audited reveal in the admin console is the way to read
-- one), a storage path, a CV, a document, a note an employer wrote about an
-- applicant, or anything a user typed into an application.
-- ---------------------------------------------------------------------------

create or replace function public.admin_support_facts(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q        text := nullif(btrim(p_query), '');
  v_user     uuid;
  v_digits   text;
  v_matches  int;
  v_auth     record;
  v_profile  record;
  v_company  record;
  v_out      jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_q is null then
    return jsonb_build_object('found', false, 'reason', 'empty');
  end if;

  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_user := v_q::uuid;
  elsif position('@' in v_q) > 0 then
    select u.id into v_user from auth.users u where lower(u.email) = lower(v_q) limit 1;
  elsif v_q ~ '^[+0-9 ()-]+$' then
    -- Stored as +20…; somebody pastes 010…, 2010… or +20 10…
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    if v_digits ~ '^0' then
      v_digits := '20' || substr(v_digits, 2);
    end if;
    select count(*), min(p.id::text)::uuid into v_matches, v_user
      from profiles p where p.whatsapp_phone = '+' || v_digits;
    if v_matches > 1 then
      return jsonb_build_object('found', false, 'reason', 'ambiguous');
    end if;
  else
    return jsonb_build_object('found', false, 'reason', 'query');
  end if;

  if v_user is null then
    return jsonb_build_object('found', false, 'reason', 'none');
  end if;

  select u.id, u.email_confirmed_at, u.confirmation_sent_at, u.recovery_sent_at,
         u.last_sign_in_at, u.created_at, u.banned_until,
         coalesce(u.raw_app_meta_data -> 'providers',
                  case when u.raw_app_meta_data ? 'provider'
                       then jsonb_build_array(u.raw_app_meta_data -> 'provider') end,
                  '[]'::jsonb) as providers
    into v_auth
    from auth.users u
   where u.id = v_user;

  if not found then
    return jsonb_build_object('found', false, 'reason', 'none');
  end if;

  select p.role::text as role, p.full_name, p.approval_status::text as approval_status,
         p.approval_note, p.approved_at, p.locale, p.created_at,
         p.whatsapp_phone is not null and p.whatsapp_phone <> '' as has_whatsapp
    into v_profile
    from profiles p
   where p.id = v_user;

  -- The company this account acts for, the way my_company_id() decides it:
  -- admin membership first, then the oldest.
  select c.id, c.name_ar, c.name_en, c.slug, c.verification_status::text as verification_status,
         c.verified_at, c.created_at, m.role::text as member_role
    into v_company
    from company_members m
    join companies c on c.id = m.company_id
   where m.user_id = v_user
   order by (m.role = 'admin') desc, m.created_at
   limit 1;

  v_out := jsonb_build_object(
    'found',   true,
    'user_id', v_user,
    'auth', jsonb_build_object(
      'email_confirmed_at',   v_auth.email_confirmed_at,
      'confirmation_sent_at', v_auth.confirmation_sent_at,
      'recovery_sent_at',     v_auth.recovery_sent_at,
      'last_sign_in_at',      v_auth.last_sign_in_at,
      'created_at',           v_auth.created_at,
      'banned_until',         v_auth.banned_until,
      'providers',            v_auth.providers
    ),
    'profile', case when v_profile.role is null then null else jsonb_build_object(
      'role',            v_profile.role,
      'full_name',       v_profile.full_name,
      'approval_status', v_profile.approval_status,
      'approval_note',   v_profile.approval_note,
      'approved_at',     v_profile.approved_at,
      'locale',          v_profile.locale,
      'created_at',      v_profile.created_at,
      'has_whatsapp',    v_profile.has_whatsapp
    ) end,
    'company', case when v_company.id is null then null else jsonb_build_object(
      'id',                  v_company.id,
      'name_ar',             v_company.name_ar,
      'name_en',             v_company.name_en,
      'slug',                v_company.slug,
      'verification_status', v_company.verification_status,
      'verified_at',         v_company.verified_at,
      'member_role',         v_company.member_role,
      -- Which papers, in what state, and what the reviewer said. Never where
      -- the file is.
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'doc_type',    d.doc_type,
                 'status',      d.status::text,
                 'review_note', d.review_note,
                 'created_at',  d.created_at,
                 'reviewed_at', d.reviewed_at) order by d.created_at desc)
          from company_documents d
         where d.company_id = v_company.id), '[]'::jsonb),
      'jobs_by_status', coalesce((
        select jsonb_object_agg(s.status, s.n)
          from (select j.status::text as status, count(*) as n
                  from jobs j where j.company_id = v_company.id group by j.status) s), '{}'::jsonb),
      'recent_jobs', coalesce((
        select jsonb_agg(r order by r.created_at desc)
          from (select j.id, j.title_ar, j.slug, j.status::text as status, j.rejection_note,
                       j.created_at, j.published_at, j.expires_at
                  from jobs j
                 where j.company_id = v_company.id
                 order by j.created_at desc
                 limit 8) r), '[]'::jsonb)
    ) end,
    'agent', (
      select jsonb_build_object(
               'slug',         a.slug,
               'visibility',   a.visibility::text,
               'availability', a.availability::text,
               'has_cv',       a.cv_path is not null,
               'created_at',   a.created_at)
        from agent_profiles a
       where a.user_id = v_user
    ),
    'applications', jsonb_build_object(
      'total', (select count(*) from applications a where a.candidate_id = v_user),
      'recent', coalesce((
        select jsonb_agg(r order by r.created_at desc)
          from (select a.id, a.status::text as status, a.created_at, j.title_ar, j.slug
                  from applications a
                  join jobs j on j.id = a.job_id
                 where a.candidate_id = v_user
                 order by a.created_at desc
                 limit 8) r), '[]'::jsonb)
    ),
    'notifications', coalesce((
      select jsonb_agg(r order by r.created_at desc)
        from (select n.kind::text as kind, n.created_at, n.read_at is not null as read
                from notifications n
               where n.user_id = v_user
               order by n.created_at desc
               limit 8) r), '[]'::jsonb),
    -- What the outbox tried to send them. Errors are the provider's text with
    -- any address in it replaced, the way observe.ts treats the same text.
    'emails', coalesce((
      select jsonb_agg(r order by r.created_at desc)
        from (select e.template, e.status::text as status, e.attempts, e.created_at,
                     e.sent_at, e.delivered_at,
                     regexp_replace(left(e.error, 300), '[[:alnum:]._%+-]+@[[:alnum:].-]+', '<address>', 'g') as error
                from email_log e
               where e.user_id = v_user
               order by e.created_at desc
               limit 8) r), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(r order by r.occurred_at desc)
        from (select s.reference, s.source, s.area, s.event, s.code, s.route, s.client,
                     s.release, s.occurred_at
                from support_events s
               where s.user_id = v_user
               order by s.occurred_at desc
               limit 12) r), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(r order by r.created_at desc)
        from (select q.id, q.reference, q.topic, q.status, q.created_at
                from support_requests q
               where q.user_id = v_user
               order by q.created_at desc
               limit 8) r), '[]'::jsonb)
  );

  return v_out;
end;
$$;

revoke execute on function public.admin_support_facts(text) from public, anon;
grant  execute on function public.admin_support_facts(text) to authenticated, service_role;
