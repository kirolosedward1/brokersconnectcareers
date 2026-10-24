-- =============================================================================
-- 364 — English slugs, and a 301 from the slug they replaced
--
-- Public job and company slugs are English words, not an Arabic
-- transliteration. The builders in src/lib/slug.ts already mint them that
-- way. This file rewrites the rows that were minted the old way and records
-- from_slug → to_slug so the middleware can 301 the old URL.
--
-- A listing slug and a company slug are permanent for ordinary writes
-- (jobs_10_guard_update, companies_guard_update). Those two, and the version
-- bumps beside them, are switched off for this backfill only and switched
-- back on before the file ends. Do not leave them off.
--
-- The numeric suffix is kept, so a row stays the same listing. A title or
-- name with no Latin letters becomes role-<district>-<digits> or
-- company-<digits>. A slug that does not end in six digits, or whose new
-- form would collide, is left as it is and gets no redirect.
--
-- saved_searches stores company=<slug>. Those query strings are rewritten.
-- A row whose new query is already saved by the same candidate is deleted
-- instead, because (candidate_id, query) is unique. Notification links are
-- /jobs/<slug>; the 301 covers them, so those rows are not rewritten.
--
-- jobs_40_bump_version and companies_40_bump_version are off for the same
-- window. A slug rewrite is not an edit of the listing: an open appeal
-- compares version, and a bump would mark that appeal as being about a
-- listing that has since changed.
--
-- Deploy the application first, then apply this file. See the ships-with-code
-- line. Do not apply it to production from this pull request.
-- =============================================================================

-- rollback: forward-fix only for the rewritten slugs — slug_redirects.from_slug still holds the previous value if a slug must be put back by hand; drop table public.slug_redirects undoes the lookup
-- safety: drop — jobs_10_guard_update and companies_guard_update refuse a slug change unless the session is acting as an admin, and the version triggers would mark a slug rewrite as an edit. All four are disabled only for this backfill and enabled again in this same file, so a later request still cannot rename a slug and a real edit still bumps version
-- safety: grant — anon and authenticated may select slug_redirects so middleware can 301 an old public URL with the anon key. Insert, update and delete stay revoked. The rows are retired public paths, not private data
-- safety: ships-with-code — deploy the app first. The lookup fails open when this table is missing, so old slugs still resolve. Applying this file first rewrites the slugs, and old URLs 404 until the new app's 301 lookup is live

alter table jobs disable trigger jobs_10_guard_update;
alter table jobs disable trigger jobs_40_bump_version;
alter table companies disable trigger companies_guard_update;
alter table companies disable trigger companies_40_bump_version;

create table public.slug_redirects (
  kind text not null check (kind in ('job', 'company')),
  from_slug text not null,
  to_slug text not null,
  primary key (kind, from_slug)
);

alter table public.slug_redirects enable row level security;

create policy slug_redirects_read on public.slug_redirects
  for select to anon, authenticated
  using (true);

grant select on table public.slug_redirects to anon, authenticated;
revoke insert, update, delete, truncate on public.slug_redirects from anon, authenticated;

-- Jobs. The district slug is the district's own slug, not a parse of the old URL.
do $$
declare
  rec record;
  digits text;
  base text;
  new_slug text;
begin
  for rec in
    select j.id, j.slug, j.title_en, d.slug as district_slug
    from jobs j
    join districts d on d.id = j.district_id
  loop
    digits := substring(rec.slug from '([0-9]{6})$');
    if digits is null then
      continue;
    end if;

    base := trim(both '-' from left(lower(regexp_replace(coalesce(rec.title_en, ''), '[^a-zA-Z0-9]+', '-', 'g')), 72));
    if base is null or base = '' then
      base := 'role';
    end if;

    new_slug := base || '-' || rec.district_slug || '-' || digits;
    if new_slug = rec.slug then
      continue;
    end if;
    if exists (select 1 from jobs where slug = new_slug and id <> rec.id) then
      continue;
    end if;
    if exists (select 1 from slug_redirects where kind = 'job' and (from_slug = rec.slug or to_slug = new_slug)) then
      continue;
    end if;

    insert into slug_redirects (kind, from_slug, to_slug)
    values ('job', rec.slug, new_slug);

    update jobs set slug = new_slug where id = rec.id;
  end loop;
end $$;

-- Companies. No district in the slug: <english-name>-<digits>, or company-<digits>.
do $$
declare
  rec record;
  digits text;
  base text;
  new_slug text;
begin
  for rec in
    select id, slug, name_en from companies
  loop
    digits := substring(rec.slug from '([0-9]{6})$');
    if digits is null then
      continue;
    end if;

    base := trim(both '-' from left(lower(regexp_replace(coalesce(rec.name_en, ''), '[^a-zA-Z0-9]+', '-', 'g')), 72));
    if base is null or base = '' then
      base := 'company';
    end if;

    new_slug := base || '-' || digits;
    if new_slug = rec.slug then
      continue;
    end if;
    if exists (select 1 from companies where slug = new_slug and id <> rec.id) then
      continue;
    end if;
    if exists (select 1 from slug_redirects where kind = 'company' and (from_slug = rec.slug or to_slug = new_slug)) then
      continue;
    end if;

    insert into slug_redirects (kind, from_slug, to_slug)
    values ('company', rec.slug, new_slug);

    update companies set slug = new_slug where id = rec.id;
  end loop;
end $$;

-- Follows. Delete first when the rewritten query is already that candidate's row.
delete from saved_searches s
using slug_redirects r
where r.kind = 'company'
  and s.query ~ ('(^|&)company=' || r.from_slug || '(&|$)')
  and exists (
    select 1
    from saved_searches other
    where other.candidate_id = s.candidate_id
      and other.id <> s.id
      and other.query = regexp_replace(
        s.query,
        '(^|&)company=' || r.from_slug || '(&|$)',
        '\1company=' || r.to_slug || '\2'
      )
  );

update saved_searches s
set query = regexp_replace(
  s.query,
  '(^|&)company=' || r.from_slug || '(&|$)',
  '\1company=' || r.to_slug || '\2'
)
from slug_redirects r
where r.kind = 'company'
  and s.query ~ ('(^|&)company=' || r.from_slug || '(&|$)');

alter table jobs enable trigger jobs_10_guard_update;
alter table jobs enable trigger jobs_40_bump_version;
alter table companies enable trigger companies_guard_update;
alter table companies enable trigger companies_40_bump_version;
