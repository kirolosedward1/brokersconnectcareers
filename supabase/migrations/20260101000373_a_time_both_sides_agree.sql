-- =============================================================================
-- 373 — A time both sides agree
--
-- An interview stage said only "interview": no time, no place, no answer
-- (docs/design/v1.1/phase-b/09). A company now invites the candidate to a
-- time — at the office, by phone or by video — and the candidate accepts,
-- declines, or proposes another time, which the company may accept. Both
-- sides hear it in the bell, and by push under the applications switch.
-- Times are instants, shown in Cairo time everywhere (decided).
--
-- Who may do what, in the database:
--   the company's members (owns_job)  read, invite, reschedule, cancel,
--                                     accept a proposed time
--   the candidate                     read their own invites; answer only
--                                     through answer_interview(), which can
--                                     change nothing but the answer and the
--                                     time they propose
--
-- Tested in supabase/tests/interviews.test.mjs.
--
-- rollback: drop function if exists public.answer_interview(uuid, text, timestamptz);
--           drop trigger if exists interview_invites_90_notify on interview_invites;
--           drop function if exists public.on_interview_changed();
--           drop table if exists interview_invites;
--           restate push_category() from migration 335
--           (the notification kinds are migration 372's and stay)
-- safety: additive — a new table and its functions. A build that does not
-- know the kinds (372) shows the bell's generic line for them.
-- safety: ships-with-code — a new table used only by actions and screens added in this branch:
--   code first, those answer an error and nothing existing changes; migration first, nobody uses it yet.
-- =============================================================================

create table if not exists interview_invites (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references applications(id) on delete cascade,
  starts_at         timestamptz not null,
  minutes           int not null default 30 check (minutes between 10 and 240),
  mode              text not null check (mode in ('office', 'phone', 'video')),
  place             text check (char_length(place) <= 300),
  note              text check (char_length(note) <= 500),
  status            text not null default 'proposed'
                    check (status in ('proposed', 'accepted', 'declined', 'counter', 'cancelled')),
  counter_starts_at timestamptz,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (status <> 'counter' or counter_starts_at is not null)
);

create index if not exists interview_invites_application_idx on interview_invites (application_id, starts_at desc);
create index if not exists interview_invites_created_by_idx on interview_invites (created_by);
create index if not exists interview_invites_starts_idx on interview_invites (starts_at) where status in ('proposed', 'accepted', 'counter');

alter table interview_invites enable row level security;

-- The company: everything about its own applications' interviews.
create policy interview_invites_company on interview_invites
  for all using (
    exists (select 1 from applications a where a.id = interview_invites.application_id and public.owns_job(a.job_id))
  ) with check (
    exists (select 1 from applications a where a.id = interview_invites.application_id and public.owns_job(a.job_id))
  );

-- The candidate: reading their own. Answering is answer_interview()'s alone.
create policy interview_invites_candidate_read on interview_invites
  for select using (
    exists (select 1 from applications a where a.id = interview_invites.application_id and a.candidate_id = (select auth.uid()))
  );

create policy interview_invites_admin on interview_invites
  for all using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on interview_invites to authenticated;

-- ---------------------------------------------------------------------------
-- The candidate's answer
-- ---------------------------------------------------------------------------

create or replace function public.answer_interview(p_id uuid, p_answer text, p_counter timestamptz default null)
returns text   -- 'ok' | 'not_found' | 'closed' | 'invalid'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite interview_invites;
begin
  if p_answer not in ('accepted', 'declined', 'counter') then
    return 'invalid';
  end if;
  if p_answer = 'counter' and (p_counter is null or p_counter < now()) then
    return 'invalid';
  end if;

  select i.* into v_invite
    from interview_invites i
    join applications a on a.id = i.application_id
   where i.id = p_id and a.candidate_id = auth.uid()
   for update of i;
  if not found then
    return 'not_found';
  end if;
  -- Only an invitation still waiting on the candidate can be answered.
  if v_invite.status <> 'proposed' then
    return 'closed';
  end if;

  update interview_invites
     set status = p_answer,
         counter_starts_at = case when p_answer = 'counter' then p_counter else null end,
         updated_at = now()
   where id = p_id;
  return 'ok';
end;
$$;

revoke execute on function public.answer_interview(uuid, text, timestamptz) from public, anon;
grant execute on function public.answer_interview(uuid, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The bell, for both sides
-- ---------------------------------------------------------------------------

create or replace function public.on_interview_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app  record;
  v_name text;
begin
  begin
    select a.id, a.candidate_id, j.id as job_id, j.company_id, j.title_ar, j.title_en
      into v_app
      from applications a join jobs j on j.id = a.job_id
     where a.id = new.application_id;

    -- To the candidate: a new invitation, or the time changed and asked again.
    if new.status = 'proposed'
       and (tg_op = 'INSERT' or old.starts_at is distinct from new.starts_at or old.status <> 'proposed') then
      perform public.notify(
        v_app.candidate_id,
        'interview_invited',
        jsonb_build_object('title_ar', v_app.title_ar, 'title_en', v_app.title_en,
                           'starts_at', new.starts_at, 'mode', new.mode, 'interview_id', new.id),
        '/dashboard/applications',
        'interview_invited:' || new.id || ':' || extract(epoch from new.starts_at)::bigint
      );
    -- To the company: the candidate's answer.
    elsif tg_op = 'UPDATE' and new.status in ('accepted', 'declined', 'counter')
          and old.status = 'proposed' then
      select full_name into v_name from profiles where id = v_app.candidate_id;
      perform public.notify_company(
        v_app.company_id,
        'interview_answered',
        jsonb_build_object('title_ar', v_app.title_ar, 'title_en', v_app.title_en,
                           'name', v_name, 'answer', new.status,
                           'starts_at', coalesce(new.counter_starts_at, new.starts_at),
                           'interview_id', new.id),
        '/employer/jobs/' || v_app.job_id || '/applicants',
        'interview_answered:' || new.id || ':' || new.status || ':' || extract(epoch from now())::bigint
      );
    end if;
  exception when others then
    raise warning 'notification for interview % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke execute on function public.on_interview_changed() from public, anon, authenticated;

drop trigger if exists interview_invites_90_notify on interview_invites;
create trigger interview_invites_90_notify
  after insert or update on interview_invites
  for each row execute function public.on_interview_changed();

-- Pushed under the applications switch, as every other application notice.
create or replace function public.push_category(p_kind notification_kind)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind = 'new_jobs' then 'job_alerts'
    when p_kind in ('application_submitted', 'application_received', 'application_withdrawn', 'application_moved',
                    'interview_invited', 'interview_answered')
      then 'applications'
    else 'account'
  end;
$$;
