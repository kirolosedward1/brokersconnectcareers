-- =============================================================================
-- 365 — A stage told three times is enough
--
-- 345 made a stage reached again after another one news: rejected →
-- shortlisted → rejected tells the candidate twice, because their last word
-- from us said "shortlisted". Nothing bounded that. An employer with an
-- application from somebody could flip it rejected ↔ shortlisted in a loop,
-- each round a bell, a push and — through setApplicationStatus — a branded
-- email carrying the employer's own 500-character decision note. That is the
-- platform's sender used as a relay against one person.
--
-- The bell now stops at the third telling of a stage, per application. The
-- email stops at the same telling (MAX_STAGE_TELLINGS in
-- src/lib/application-arrival.ts), so the two still agree on every move;
-- supabase/tests/notices.test.mjs holds them to each other. A real pipeline
-- tells a stage once, and twice when a decision is reversed; a third reversal
-- is still told; a fourth is not news anyone needs.
--
-- The function is 362's, with the one check added after v_told is counted.
-- =============================================================================

-- rollback: re-run the create or replace function public.on_application_moved() block from migration 20260101000362_a_withdrawal_keeps_the_record.sql
-- safety: ships-with-code — the bell stops at the third telling here and the email at the same telling in notify.ts; applied before the code, the bell is capped and the email is not, and a candidate in that window gets an email the bell no longer echoes, which is the state before this file for the email alone

create or replace function public.on_application_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job       record;
  v_before    bigint;
  v_last_told application_status;
  v_told      bigint;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'withdrawn' then
    return new;
  end if;

  if new.status = 'new' then
    return new;
  end if;

  begin
    select max(e.id) into v_before
      from application_events e
     where e.application_id = new.id and e.to_status = old.status;

    select e.to_status into v_last_told
      from application_events e
     where e.application_id = new.id and e.to_status <> 'new' and e.id <= v_before
     order by e.id desc
     limit 1;

    if v_last_told is not distinct from new.status then
      return new;
    end if;

    select count(*) into v_told
      from (
        select e.to_status, lag(e.to_status) over (order by e.id) as before
          from application_events e
         where e.application_id = new.id and e.to_status <> 'new' and e.id <= v_before
      ) told
     where told.to_status = new.status and told.before is distinct from told.to_status;

    -- Third telling of this stage is the last. v_told counts the tellings
    -- before this one (notify.ts MAX_STAGE_TELLINGS says the same for the
    -- email), so an employer flipping one application back and forth rings
    -- the bell, and the phone, three times per stage and no more.
    if v_told >= 3 then
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
      '/dashboard/applications',
      'application_moved:' || new.id || ':' || new.status::text
        || case when v_told > 0 then ':' || (v_told + 1)::text else '' end
    );
  exception when others then
    raise warning 'notification for application % move failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;
