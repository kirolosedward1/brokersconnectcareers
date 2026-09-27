-- =============================================================================
-- 70 — Files nothing points at, and a featured flag that is not an edit
--
-- Two loose ends from migration 69.
--
-- 1. Orphaned uploads
--
-- Every upload on this platform goes straight from the browser into a bucket
-- under a fresh random name, and only afterwards is the row updated to point
-- at it. So every replacement leaves the previous file behind: a new avatar
-- orphans the old one, a new logo the old logo, a new CV the old CV. A deleted
-- account leaves whatever deleteAccount()'s single `list()` page did not
-- reach. An abandoned application form leaves a CV nobody submitted.
--
-- For avatars and logos that is only storage. For CVs it is a personal
-- document the platform keeps with no row, no screen and no owner able to see
-- that it still exists — which is the part that makes this worth doing.
--
-- orphaned_storage_objects() names them; the hourly maintenance job removes
-- them through the Storage API (deleting storage.objects rows directly would
-- leave the bytes behind). The rules are written to fail towards keeping:
--
--   grace     — nothing younger than seven days. An upload is written before
--               the row that points at it, and a half-finished form must not
--               lose its file underneath it.
--   CVs       — referenced when any application or agent profile names the
--               exact path. Paths are stored verbatim, so there is no format
--               to misread.
--   images    — the rows store a public URL, not a path. An image is only
--               treated as orphaned when its owner (the first folder segment:
--               a user id for avatars, a company id for logos) is gone, has
--               no image, or has one that is recognisably a URL into this
--               same bucket and names a different file. An owner whose URL is
--               in any other shape keeps every file — a changed URL format
--               must never read as "nothing references this".
--   scope     — company-documents is deliberately excluded. Those are
--               verification evidence, and how long to keep them is a
--               decision for whoever answers for verification, not for a
--               housekeeping job.
--
-- 2. bump_version and the featured flag
--
-- `version` exists for two things: the edit-conflict check (migration 50) and
-- the moderation email dedupe keys (job_submitted/approved/rejected carry it).
-- Migration 69 stopped view_count from moving it. Featuring a listing, and the
-- nightly job un-featuring it, are the same kind of write — nobody's edit, and
-- the employer's form never writes those columns, so no edit can be lost by
-- not counting them. Counting them moved the dedupe key between a failed
-- approval email and its retry, so the retry claimed a new row instead of
-- retrying in place.
-- =============================================================================

create or replace function public.bump_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Columns the platform writes on its own. A change confined to these is not
  -- an edit: it must not raise an edit conflict or move a dedupe key.
  v_system constant text[] := array[
    'view_count', 'is_featured', 'featured_until', 'updated_at', 'version', 'search_vector'
  ];
begin
  -- Something the platform owns changed, and nothing else did. Asked of the
  -- three columns by name rather than as "the rows differ": search_vector
  -- reads as null in a BEFORE trigger's NEW, so whole rows always differ, and
  -- a true no-op write — which migration 50 counts on purpose — would slip
  -- through as a system write. On companies none of the three exist, the
  -- first condition is never true, and every write still counts.
  if (   (to_jsonb(new) ->> 'view_count')     is distinct from (to_jsonb(old) ->> 'view_count')
      or (to_jsonb(new) ->> 'is_featured')    is distinct from (to_jsonb(old) ->> 'is_featured')
      or (to_jsonb(new) ->> 'featured_until') is distinct from (to_jsonb(old) ->> 'featured_until'))
     and (to_jsonb(new) - v_system) = (to_jsonb(old) - v_system)
  then
    new.version := old.version;
    return new;
  end if;

  -- Every other update, including ones that change nothing else: a no-op
  -- write is still a write, and treating it as one keeps the number honest.
  new.version := old.version + 1;
  return new;
end;
$$;

revoke execute on function public.bump_version() from public, anon, authenticated;

create or replace function public.orphaned_storage_objects(
  p_limit integer default 100,
  p_grace interval default '7 days'
)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with candidates as (
    select o.bucket_id, o.name, split_part(o.name, '/', 1) as owner_key
      from storage.objects o
     where o.bucket_id in ('avatars', 'company-logos', 'cvs')
       -- Never shorter than a day, whatever the caller passes.
       and o.created_at < now() - greatest(coalesce(p_grace, interval '7 days'), interval '1 day')
  ),
  image_owner as (
    select c.bucket_id, c.name,
           case c.bucket_id
             when 'avatars' then (
               select p.avatar_url from profiles p where p.id::text = c.owner_key
             )
             else (
               select co.logo_url from companies co where co.id::text = c.owner_key
             )
           end as url,
           case c.bucket_id
             when 'avatars' then exists (select 1 from profiles p where p.id::text = c.owner_key)
             else exists (select 1 from companies co where co.id::text = c.owner_key)
           end as owner_exists
      from candidates c
     where c.bucket_id in ('avatars', 'company-logos')
  )
  select i.bucket_id, i.name
    from image_owner i
   where not i.owner_exists
      or i.url is null
      or (
        -- Recognisably a public URL into this bucket …
        position('/object/public/' || i.bucket_id || '/' in i.url) > 0
        -- … naming some other file.
        and split_part(split_part(i.url, '/object/public/' || i.bucket_id || '/', 2), '?', 1)
            <> i.name
      )
  union all
  select c.bucket_id, c.name
    from candidates c
   where c.bucket_id = 'cvs'
     and not exists (select 1 from applications a where a.cv_path = c.name)
     and not exists (select 1 from agent_profiles ap where ap.cv_path = c.name)
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

comment on function public.orphaned_storage_objects(integer, interval) is
  'Service role only. Uploads in avatars, company-logos and cvs that no row references, older than the grace period. See migration 70 for the keep-when-unsure rules.';

revoke all on function public.orphaned_storage_objects(integer, interval) from public, anon, authenticated;
