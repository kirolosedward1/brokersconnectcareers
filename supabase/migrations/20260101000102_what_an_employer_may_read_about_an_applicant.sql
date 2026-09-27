-- =============================================================================
-- 102 — What an employer may read about an applicant
--
-- profiles_select_applicants lets a company read the profile of anyone who
-- applied to one of its listings, which is the point: the name and the
-- WhatsApp number are how an interview gets arranged. It hands over the whole
-- row, and two of the columns on that row were never meant for anybody but the
-- platform.
--
-- unsubscribe_token is a credential. It is the one thing an email needs to
-- turn a person's notifications off without a session, and a company holding
-- an applicant's token can silence the messages that tell that applicant an
-- employer has replied — theirs or anyone else's.
--
-- approval_note is a reviewer's remark about the account — "documents did not
-- match", "suspended after reports" — written for other reviewers.
--
-- Both move to profile_private, one row per profile, with no policy that lets
-- anybody but an admin read it and none at all that lets anybody write it. The
-- email code reads it with the service role, which it already used; the
-- unsubscribe endpoint looks the token up there; the approval function writes
-- its note there. The two columns then leave profiles, so no SELECT on that
-- table — however wide — can carry them again.
--
-- Everything that touched the old columns is restated before they are
-- dropped: a trigger body that names a column the table no longer has fails
-- at the next update, which would have been every profile save on the site.
-- =============================================================================

create table profile_private (
  user_id            uuid primary key references profiles on delete cascade,
  unsubscribe_token  uuid not null default gen_random_uuid(),
  approval_note      text check (length(approval_note) <= 500),
  updated_at         timestamptz not null default now()
);

create unique index profile_private_token_idx on profile_private (unsubscribe_token);

alter table profile_private enable row level security;

-- Reviewers read the note beside the account it is about. Nobody writes
-- through the API: the token is minted by the row's default and the note by
-- set_account_approval().
create policy profile_private_admin_read on profile_private
  for select using (public.is_admin());

-- Carry the existing values across before anything reads from here.
insert into profile_private (user_id, unsubscribe_token, approval_note)
select id, unsubscribe_token, approval_note from profiles
on conflict (user_id) do nothing;

-- Every profile has its private row from the moment it exists.
create or replace function public.ensure_profile_private()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into profile_private (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.ensure_profile_private() from public, anon, authenticated;

create trigger profiles_05_private_row
  after insert on profiles
  for each row execute function public.ensure_profile_private();

-- ---------------------------------------------------------------------------
-- The approval lever writes its note beside the account, not on it
-- ---------------------------------------------------------------------------

create or replace function public.set_account_approval(
  p_user   uuid,
  p_status approval_status,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_user = auth.uid() then
    raise exception 'an admin cannot change their own approval';
  end if;

  if not exists (select 1 from profiles where id = p_user and role <> 'admin') then
    raise exception 'no such account, or it belongs to an admin';
  end if;

  -- The note first: the notification trigger on profiles reads it, and an
  -- AFTER trigger fires before the statement after the UPDATE runs.
  insert into profile_private (user_id, approval_note, updated_at)
  values (p_user, left(p_note, 500), now())
  on conflict (user_id) do update
    set approval_note = excluded.approval_note,
        updated_at    = now();

  update profiles
     set approval_status = p_status,
         approved_at     = case when p_status = 'approved' then now() else null end
   where id = p_user
     and role <> 'admin';

  if p_status = 'rejected' then
    update jobs
       set status = 'rejected',
           rejection_note = coalesce(p_note, 'الحساب موقوف')
     where status in ('active', 'pending_review')
       and company_id in (
         select cm.company_id
           from company_members cm
          where cm.user_id = p_user
            and not exists (
              select 1
                from company_members peer
                join profiles p on p.id = peer.user_id
               where peer.company_id = cm.company_id
                 and peer.user_id <> p_user
                 and p.approval_status = 'approved'
            )
       );
  end if;
end;
$$;

-- The notification that follows a decision reads the note from its new home.
create or replace function public.on_approval_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text;
begin
  if new.approval_status is not distinct from old.approval_status then
    return new;
  end if;

  if new.approval_status = 'approved' then
    perform public.notify(new.id, 'account_approved', '{}'::jsonb,
                          case when new.role = 'employer' then '/employer' else '/dashboard' end);
  elsif new.approval_status = 'rejected' then
    select approval_note into v_note from profile_private where user_id = new.id;
    perform public.notify(new.id, 'account_rejected',
                          jsonb_build_object('note', v_note), null);
  end if;

  return new;
end;
$$;

-- The guard, minus the two columns it will no longer see. Migration 47's rule
-- that an admin may not change their own approval stays.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    if new.id = (select auth.uid())
       and (new.role, new.approval_status, new.approved_at)
           is distinct from
           (old.role, old.approval_status, old.approved_at)
    then
      raise exception 'an admin cannot change their own approval';
    end if;

    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role changes are an admin action';
  end if;

  if (new.approval_status, new.approved_at)
     is distinct from
     (old.approval_status, old.approved_at)
  then
    raise exception 'approval is an admin action';
  end if;

  -- The account's own clock is not the account's to set.
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not user-writable';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- And the columns go
-- ---------------------------------------------------------------------------

alter table profiles
  drop column if exists unsubscribe_token,
  drop column if exists approval_note;
