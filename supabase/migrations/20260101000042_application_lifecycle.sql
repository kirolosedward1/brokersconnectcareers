-- The application lifecycle: a withdrawal rule the database enforces, and a
-- record of how an application got where it is.
--
-- Two gaps, both of the kind Round 3 exists to close.
--
-- Withdrawing was a rule the interface kept and the database did not. The
-- dashboard offers "اسحب الطلب" only while an application is new or
-- shortlisted, but applications_withdraw_candidate permitted a delete at any
-- status — so a hired candidate could remove the record of their own hire,
-- and the employer's only evidence of it, with one request the UI never makes.
-- Frontend-only validation is not validation.
--
-- And the status was its own history: an employer moves an application from
-- new to rejected and the fact that it was ever shortlisted is gone, along
-- with when and by whom. That is the one question a disagreement actually
-- turns on, and it is also what "time to first response" would be measured
-- from. The table below is deliberately thin — the transition, the actor and
-- the moment, and nothing about the person.

-- ---------------------------------------------------------------------------
-- Withdrawal has a precondition now, and it is the one the UI already shows.
-- ---------------------------------------------------------------------------
drop policy if exists applications_withdraw_candidate on applications;

create policy applications_withdraw_candidate on applications
  for delete using (
    -- (select auth.uid()) rather than a bare call: the planner runs it once
    -- for the statement instead of once per row.
    candidate_id = (select auth.uid())
    and status in ('new', 'shortlisted')
  );

comment on policy applications_withdraw_candidate on applications is
  'A candidate may withdraw while the outcome is still open. Once an employer
   has moved them to interview, hired or rejected, the record is the
   employer''s evidence too and withdrawing would destroy it.';

-- ---------------------------------------------------------------------------
-- How an application got where it is.
-- ---------------------------------------------------------------------------
create table if not exists application_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references applications(id) on delete cascade,
  from_status    application_status,
  to_status      application_status not null,
  -- Null when the account is later deleted: the transition still happened.
  actor_id       uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Every read is "this application, in order".
create index if not exists application_events_application_idx
  on application_events (application_id, created_at);

alter table application_events enable row level security;

-- Whoever may see the application may see how it moved. Nobody writes here
-- directly — the only INSERT is the trigger below, which runs as its definer,
-- so the absence of an insert policy is the point rather than an oversight.
create policy application_events_select on application_events
  for select using (
    exists (
      select 1 from applications a
      where a.id = application_events.application_id
        and (a.candidate_id = (select auth.uid()) or public.owns_job(a.job_id))
    )
    or public.is_admin()
  );

create or replace function public.record_application_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into application_events (application_id, from_status, to_status, actor_id)
    values (new.id, null, new.status, auth.uid());
    return new;
  end if;

  -- Only a move. An employer saving a decision note, or the view stamp being
  -- written, is not a transition and must not look like one.
  if new.status is distinct from old.status then
    insert into application_events (application_id, from_status, to_status, actor_id)
    values (new.id, old.status, new.status, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists applications_record_event on applications;
create trigger applications_record_event
  after insert or update on applications
  for each row execute function public.record_application_event();

-- Backfill: every application that exists now got to its status somehow, and
-- an empty history would read as "nothing ever happened" rather than "we did
-- not keep this yet". One row each, honest about what is known — the current
-- status, at the time the row was created, with no actor claimed.
insert into application_events (application_id, from_status, to_status, actor_id, created_at)
select a.id, null, a.status, null, a.created_at
from applications a
where not exists (select 1 from application_events e where e.application_id = a.id);
