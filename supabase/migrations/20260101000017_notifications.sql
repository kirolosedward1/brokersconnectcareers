-- =============================================================================
-- 17 — Notifications
--
-- The events that change what somebody should do next, delivered in the app.
--
-- Rows hold data, never prose. This site is read in Arabic and English, and a
-- sentence written into the row at the moment it happened is a sentence in
-- whichever language the writer guessed — which is wrong for half the readers
-- and stays wrong forever. The payload carries ids and a snapshot of the few
-- fields the message needs; the interface renders it through the same message
-- catalogue as every other string.
--
-- The snapshot is deliberate rather than lazy. "Somebody applied to Property
-- Consultant — New Cairo" is a record of what happened; joining to the listing
-- at read time would rewrite history every time the listing was retitled, and
-- would leave the row unreadable once it was deleted.
--
-- Users may read, mark read, and delete their own. Nobody may insert: every
-- row here comes from a trigger, and an account that can write its own
-- notifications can write one that appears to come from the platform.
-- =============================================================================

create type notification_kind as enum (
  'application_received',   -- employer: somebody applied to your listing
  'application_moved',      -- candidate: an employer moved you along
  'job_published',          -- employer: moderation approved your listing
  'job_rejected',           -- employer: moderation refused it
  'company_verified',       -- employer: your documents checked out
  'account_approved',       -- employer: your account may now post
  'account_rejected'        -- either: your account was suspended
);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  kind       notification_kind not null,
  payload    jsonb not null default '{}'::jsonb,
  -- Locale-free, so the same row reads correctly on both sides of the site;
  -- the Link component adds the prefix.
  href       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- The feed query is "mine, newest first"; the badge is "how many of mine are
-- unread". Two indexes because they are two different questions, and the
-- partial one stays small however long the feed grows.
create index notifications_feed_idx   on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

alter table notifications enable row level security;

create policy notifications_select_own on notifications
  for select using (user_id = auth.uid());

-- Marking as read is the only thing a reader may change, so the check pins
-- every other column to what it already was.
create policy notifications_update_own on notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete_own on notifications
  for delete using (user_id = auth.uid());

create policy notifications_admin_all on notifications
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.guard_notification_update()
returns trigger
language plpgsql
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if (new.id, new.user_id, new.kind, new.payload, new.href, new.created_at)
     is distinct from
     (old.id, old.user_id, old.kind, old.payload, old.href, old.created_at)
  then
    raise exception 'only read_at is user-writable on a notification';
  end if;

  return new;
end;
$$;

create trigger notifications_guard_update
  before update on notifications
  for each row execute function public.guard_notification_update();

-- ---------------------------------------------------------------------------
-- Writing them
--
-- One private helper, so every event below records the same shape and no
-- trigger has to remember the column list.
-- ---------------------------------------------------------------------------

create or replace function public.notify(
  p_user    uuid,
  p_kind    notification_kind,
  p_payload jsonb,
  p_href    text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notifications (user_id, kind, payload, href)
  -- A notification with no owner is not an error worth failing a listing
  -- publish for; it is simply nobody's, so it is not written.
  select p_user, p_kind, coalesce(p_payload, '{}'::jsonb), p_href
   where p_user is not null;
$$;

revoke execute on function public.notify(uuid, notification_kind, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An application arrives → tell the company that owns the listing
-- ---------------------------------------------------------------------------

create or replace function public.on_application_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     record;
  v_owner   uuid;
begin
  select j.id, j.title_ar, j.title_en, c.owner_id
    into v_job
    from jobs j join companies c on c.id = j.company_id
   where j.id = new.job_id;

  v_owner := v_job.owner_id;

  perform public.notify(
    v_owner,
    'application_received',
    jsonb_build_object(
      'job_id',    v_job.id,
      'title_ar',  v_job.title_ar,
      'title_en',  v_job.title_en
    ),
    '/employer/jobs/' || v_job.id || '/applicants'
  );

  return new;
end;
$$;

create trigger applications_notify_employer
  after insert on applications
  for each row execute function public.on_application_created();

-- ---------------------------------------------------------------------------
-- An application moves → tell the candidate
-- ---------------------------------------------------------------------------

create or replace function public.on_application_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select j.title_ar, j.title_en, j.slug into v_job from jobs j where j.id = new.job_id;

  perform public.notify(
    new.candidate_id,
    'application_moved',
    jsonb_build_object(
      'status',   new.status::text,
      'title_ar', v_job.title_ar,
      'title_en', v_job.title_en,
      'slug',     v_job.slug,
      'note',     new.decision_note
    ),
    '/dashboard/applications'
  );

  return new;
end;
$$;

create trigger applications_notify_candidate
  after update on applications
  for each row execute function public.on_application_moved();

-- ---------------------------------------------------------------------------
-- Moderation decides on a listing → tell its owner
-- ---------------------------------------------------------------------------

create or replace function public.on_job_moderated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('active', 'rejected') then
    return new;
  end if;

  select owner_id into v_owner from companies where id = new.company_id;

  perform public.notify(
    v_owner,
    -- Cast, because a CASE over two string literals is typed `text`, and the
    -- overload it then looks for does not exist. Publishing a listing failed
    -- outright until this was pinned to the enum.
    (case when new.status = 'active' then 'job_published' else 'job_rejected' end)::notification_kind,
    jsonb_build_object(
      'job_id',   new.id,
      'title_ar', new.title_ar,
      'title_en', new.title_en,
      'slug',     new.slug,
      'note',     new.rejection_note
    ),
    case when new.status = 'active'
         then '/jobs/' || new.slug
         else '/employer/jobs/' || new.id || '/edit'
    end
  );

  return new;
end;
$$;

create trigger jobs_notify_owner
  after update on jobs
  for each row execute function public.on_job_moderated();

-- ---------------------------------------------------------------------------
-- Documents check out → tell the owner
-- ---------------------------------------------------------------------------

create or replace function public.on_company_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is not distinct from old.verification_status then
    return new;
  end if;
  if new.verification_status <> 'verified' then
    return new;
  end if;

  perform public.notify(
    new.owner_id,
    'company_verified',
    jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
    '/employer/company'
  );

  return new;
end;
$$;

create trigger companies_notify_owner
  after update on companies
  for each row execute function public.on_company_verified();

-- ---------------------------------------------------------------------------
-- An account is approved or suspended → tell whoever it belongs to
-- ---------------------------------------------------------------------------

create or replace function public.on_approval_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approval_status is not distinct from old.approval_status then
    return new;
  end if;

  if new.approval_status = 'approved' then
    perform public.notify(new.id, 'account_approved', '{}'::jsonb,
                          case when new.role = 'employer' then '/employer' else '/dashboard' end);
  elsif new.approval_status = 'rejected' then
    perform public.notify(new.id, 'account_rejected',
                          jsonb_build_object('note', new.approval_note), null);
  end if;

  return new;
end;
$$;

create trigger profiles_notify_approval
  after update on profiles
  for each row execute function public.on_approval_changed();

-- ---------------------------------------------------------------------------
-- Reading them
--
-- Marking the whole feed read is one statement rather than one per row, and it
-- scopes itself to auth.uid() so there is no id to get wrong.
-- ---------------------------------------------------------------------------

create or replace function public.mark_notifications_read()
returns int
language sql
security definer
set search_path = public
as $$
  with updated as (
    update notifications set read_at = now()
     where user_id = auth.uid() and read_at is null
     returning 1
  )
  select count(*)::int from updated;
$$;

revoke execute on function public.mark_notifications_read() from public, anon;
grant  execute on function public.mark_notifications_read() to authenticated, service_role;
