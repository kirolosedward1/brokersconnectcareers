-- =============================================================================
-- 302 — Twenty applicants, one row; a feed that forgets; a receipt for the
--      person who pressed submit
--
-- Three follow-ups to migrations 300/301.
--
-- 1. The applicant flood
--    Every applicant was one row in every member's bell. For the listing that
--    takes twenty applications in an afternoon that is twenty rows saying the
--    same sentence, pushing everything else — a rejection note, an expiry —
--    off the six-row panel. Email solved this with the daily digest
--    (migration 28); the bell had nothing.
--
--    So while a member has an *unread* "new applicant for X", the next
--    applicant to X folds into it: the head row's payload.count goes up and it
--    moves back to the top, and the new applicant's own row is written already
--    read and pointing at the head (`folded_into`). The feed shows heads only.
--
--    The per-candidate row is still written, and that is the point: it holds
--    the dedupe key `application_received:{job}:{candidate}`, so apply →
--    withdraw → apply still counts one person once, and a replay still writes
--    nothing. Once the member reads the head, the next applicant starts a new
--    one — "3 new" means three since you last looked, never a running total.
--
-- 2. Retention
--    Nothing was ever deleted. A read notification older than 180 days is not
--    something anybody scrolls to, and every one is a row in the feed index.
--    Pruned in two places, neither of which needs a scheduler that production
--    may not run: for the caller whenever they mark their feed read, and for
--    everybody from the nightly expiry cron when it does run. Unread rows are
--    never pruned: something nobody has seen yet is not history.
--
-- 3. The outbox can say who a message was for
--    pending_emails() returned the entity but not the recipient, so a retry
--    could only re-derive "the owner". Returning user_id lets the retry of a
--    submission receipt go back to whoever submitted the listing.
-- =============================================================================

-- rollback: re-run migration 301's on_application_created and
--   mark_notifications_read, migration 300's guard_notification_update, and
--   migration 27's pending_emails (drop the five-column one first); drop
--   function notify_company_applicant, prune_notifications; then
--   delete from notifications where folded_into is not null;
--   alter table notifications drop column folded_into;
-- safety: ships-with-code — deploy the code first, then run 300–302. The code
--   tolerates the old schema: a missing folded_into column (42703) falls back
--   to the unfiltered feed, a missing open_notification or bounded
--   mark_notifications_read (PGRST202) falls back to the old path, and the
--   sweep, prune and keyed notify() calls fail into a logged warning. The
--   reverse is not safe: the old renderer has no icon for the kinds these
--   files add, and throws on the first one written. The new renderer shows
--   any kind it does not know as a plain notice.

alter table notifications
  add column if not exists folded_into uuid references notifications (id) on delete cascade;

comment on column notifications.folded_into is
  'Set on an applicant notice absorbed into an unread "N new applicants" row for the same listing. Hidden from the feed; kept for its dedupe key. See migration 302.';

-- The fold's lookup: this member's unread applicant heads.
create index if not exists notifications_applicant_head_idx
  on notifications (user_id, (payload->>'job_id'))
  where kind = 'application_received' and read_at is null and folded_into is null;

-- The cascade's lookup, which would otherwise scan the table per deleted head.
create index if not exists notifications_folded_into_idx
  on notifications (folded_into) where folded_into is not null;

-- ---------------------------------------------------------------------------
-- The guard, aimed at the API roles
--
-- It exists to stop a *reader* rewriting what the platform told them. Folding
-- is the platform updating its own row from a SECURITY DEFINER function, which
-- runs as the function's owner — so the guard now applies to the roles that
-- arrive over the API and to nobody else. Admins keep their exemption.
-- ---------------------------------------------------------------------------

create or replace function public.guard_notification_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if public.acting_as_admin() then
    return new;
  end if;

  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'only read_at is user-writable on a notification';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_notification_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The folding writer
-- ---------------------------------------------------------------------------

create or replace function public.notify_company_applicant(
  p_company uuid,
  p_job     uuid,
  p_payload jsonb,
  p_href    text,
  p_key     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
  v_head   uuid;
  v_new    uuid;
begin
  for v_member in
    select m.user_id from company_members m where m.company_id = p_company
  loop
    -- Locked, so two applications arriving together fold one after the other
    -- rather than both reading the same count.
    select n.id into v_head
      from notifications n
     where n.user_id = v_member
       and n.kind = 'application_received'
       and n.read_at is null
       and n.folded_into is null
       and n.payload->>'job_id' = p_job::text
     order by n.created_at desc
     limit 1
     for update;

    if v_head is null then
      insert into notifications (user_id, kind, payload, href, dedupe_key)
      values (v_member, 'application_received',
              coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('count', 1),
              p_href, p_key)
      on conflict do nothing;
    else
      insert into notifications (user_id, kind, payload, href, dedupe_key, read_at, folded_into)
      values (v_member, 'application_received', coalesce(p_payload, '{}'::jsonb),
              p_href, p_key, now(), v_head)
      on conflict do nothing
      returning id into v_new;

      -- Only a person not already counted moves the number. A replay, or a
      -- candidate who withdrew and came back, lost the insert above.
      if v_new is not null then
        update notifications
           set payload    = jsonb_set(payload, '{count}',
                              to_jsonb(coalesce((payload->>'count')::int, 1) + 1)),
               created_at = now()
         where id = v_head;
      end if;
    end if;

    v_head := null;
    v_new  := null;
  end loop;
end;
$$;

revoke execute on function public.notify_company_applicant(uuid, uuid, jsonb, text, text)
  from public, anon, authenticated;

-- Restated whole: migration 301's body, with the company half folding.
create or replace function public.on_application_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  begin
    select j.id, j.slug, j.title_ar, j.title_en, j.company_id, c.name_ar, c.name_en
      into v_job
      from jobs j join companies c on c.id = j.company_id
     where j.id = new.job_id;

    perform public.notify_company_applicant(
      v_job.company_id,
      v_job.id,
      jsonb_build_object(
        'job_id',    v_job.id,
        'title_ar',  v_job.title_ar,
        'title_en',  v_job.title_en
      ),
      '/employer/jobs/' || v_job.id || '/applicants',
      'application_received:' || v_job.id || ':' || new.candidate_id
    );

    perform public.notify(
      new.candidate_id,
      'application_submitted',
      jsonb_build_object(
        'job_id',     v_job.id,
        'title_ar',   v_job.title_ar,
        'title_en',   v_job.title_en,
        'company_ar', v_job.name_ar,
        'company_en', v_job.name_en
      ),
      '/dashboard/applications',
      'application_submitted:' || new.id
    );
  exception when others then
    raise warning 'notification for application % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

revoke execute on function public.on_application_created() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Everybody's, from the cron. Bounded per run so a first run on a large
-- table is a series of small deletes rather than one long lock.
create or replace function public.prune_notifications(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_read integer := public.retention_days('notifications_read');
  v_unread integer := public.retention_days('notifications_unread');
  v_count integer;
begin
  if v_read is null and v_unread is null then
    return 0;
  end if;

  with doomed as (
    select id from notifications
     where ((v_read is not null and read_at is not null
               and created_at < now() - make_interval(days => v_read))
         or (v_unread is not null and read_at is null
               and created_at < now() - make_interval(days => v_unread)))
       and folded_into is null
     order by created_at
     limit least(greatest(p_limit, 1), 50000)
     for update skip locked
  )
  delete from notifications n using doomed d where n.id = d.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.prune_notifications(integer) from public, anon, authenticated;
-- Explicit, for the reason given on notify() in migration 301: the cron must
-- not depend on which role ran this file.
grant  execute on function public.prune_notifications(integer) to service_role;

-- The caller's own, whenever they clear their feed. Restated whole from 69.
create or replace function public.mark_notifications_read(p_up_to timestamptz default null)
returns int
language sql
security definer
set search_path = public
as $$
  with pruned as (
    delete from notifications
     where user_id = (select auth.uid())
       and read_at is not null
       and public.retention_days('notifications_read') is not null
       and created_at < now() - make_interval(days => public.retention_days('notifications_read'))
       and folded_into is null
  ),
  updated as (
    update notifications set read_at = now()
     where user_id = (select auth.uid())
       and read_at is null
       and (p_up_to is null or created_at <= p_up_to)
     returning 1
  )
  select count(*)::int from updated;
$$;

revoke execute on function public.mark_notifications_read(timestamptz) from public, anon;
grant  execute on function public.mark_notifications_read(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The retry sweeper learns who a message was for
-- ---------------------------------------------------------------------------

drop function if exists public.pending_emails(integer);

create or replace function public.pending_emails(p_limit integer default 25)
returns table (id uuid, template text, entity_id uuid, user_id uuid, attempts smallint)
language sql
security definer
set search_path = public
as $$
  select e.id, e.template, e.entity_id, e.user_id, e.attempts
    from email_log e
   where e.status in ('queued', 'failed')
     and e.attempts < 3
     and e.created_at < now() - interval '5 minutes'
     and e.created_at > now() - interval '3 days'
   order by e.created_at
   limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.pending_emails(integer) from public, anon, authenticated;
grant execute on function public.pending_emails(integer) to service_role;
