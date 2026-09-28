-- =============================================================================
-- 330 — An owner may ask to leave
--
-- Deleting an account that owns a company would take the company with it: its
-- listings, and the applications other people sent to them (the cascade runs
-- profiles -> companies -> jobs -> applications). So deleteMyAccount refuses
-- an owner (owns_company) and the page asked them to write to us — which left
-- the request with nowhere to be written, and the App Store asks that deleting
-- an account can be started inside the app, with how long it takes said when
-- it is not immediate.
--
-- A request for that is now a support request like any other, under its own
-- topic:
--
--   support_requests.topic   gains 'account_deletion'.
--   submit_support_request() accepts it — the same function, word for word,
--                            with one more topic: the account and role come
--                            from the session, five a day per account, and a
--                            retry with the same key converges on the same
--                            reference.
--
-- The website's requestAccountDeletion files it for an owner (the app and the
-- account page both offer it), and the admin console's overview lists the
-- open ones — admins already read support_requests under migration 201's
-- policy — until somebody closes them with admin_answer_support_request().
-- Nothing is deleted by filing one: an operator does that, deciding what
-- happens to the company.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: delete from support_requests where topic = 'account_deletion'; alter table support_requests drop constraint support_requests_topic_check; alter table support_requests add constraint support_requests_topic_check check (topic in ('login', 'verification_email', 'apply', 'cv_upload', 'company_verification', 'job_not_published', 'profile_visibility', 'directory_access', 'other')); then restate submit_support_request() from migration 201.
-- safety: constraint — the check only widens: every value it allowed before is still allowed, so no existing row can fail it
-- safety: function — submit_support_request() keeps its signature, grants and body; the list of topics it accepts gains one
-- safety: grant, revoke-anon — the grants migration 201 gave this function, restated unchanged: open to anon on purpose (somebody who cannot sign in is who the help form is for), held by its own limits per address, per signed-out hour and per account
-- safety: ships-with-code — safe in either order: until this is applied, requestAccountDeletion is refused with invalid_topic, which the website and the app answer with the page's old words (write to us); once applied, the only reader of the new topic is the admin overview

alter table support_requests drop constraint if exists support_requests_topic_check;
alter table support_requests add constraint support_requests_topic_check check (topic in (
  'login', 'verification_email', 'apply', 'cv_upload',
  'company_verification', 'job_not_published',
  'profile_visibility', 'directory_access', 'account_deletion', 'other'));

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
       'job_not_published', 'profile_visibility', 'directory_access', 'account_deletion', 'other') then
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
