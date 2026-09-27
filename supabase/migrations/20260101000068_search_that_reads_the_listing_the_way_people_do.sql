-- =============================================================================
-- 68 — Search that reads a listing the way people describe it
--
-- Audited against the live search paths before changing anything. Four
-- findings, each reproduced against this schema rather than assumed:
--
--   1. Migration 23 said a listing written معادي is found by المعادي. It is
--      not. The query side sent both forms joined by AND, and a document that
--      never had the article only carries one of them:
--
--        to_tsvector(ar_search_text('معادي'))
--          @@ websearch_to_tsquery(ar_search_text('المعادي'))   → false
--
--      The document side already stores the bare form of every word, so the
--      fix is for the query to ask for the bare form only.
--
--   2. مسئول and مسؤول — the Egyptian and the standard spelling of the same
--      word, and the first word of half the titles on this board — folded to
--      two different strings (مسيول, مسوول). Neither found the other.
--
--   3. Only exact words matched. مبيع did not find مبيعات, and مهندس did not
--      find مهندسين. Arabic attaches its plurals and its feminine to the end of
--      the word, so exact-word matching fails exactly where people are least
--      careful.
--
--   4. The search read the title and the description and nothing else. The
--      district, the company and the specialisation are the three things a
--      person actually types — "مبيعات التجمع", "Sales New Cairo", a
--      brokerage's name — and none of them were in the index. Whether
--      "التجمع" found a listing in التجمع الخامس depended on whether its
--      author happened to repeat the district in the prose.
--
-- What this is not: a new search engine. Measured with
-- supabase/tests/search-bench.mjs at 20,000 listings (16,000 live) — far past
-- what a 10k-MAU board carries — in PGlite, which is single-threaded
-- WebAssembly and so slower than the real instance:
--
--   a page for a common word (half the board)          ~1 ms
--   a page for a rare word, or one matching nothing     2–3 ms   GIN index
--   a page for a word on one listing in twenty          ~120 ms  board order
--   a keyword + track + district page                   ~50–100 ms
--
-- The exact count PostgREST runs beside each page costs what it cost before
-- a keyword was added (~350 ms here with or without one) — that is the row-
-- level security predicate evaluated per live listing, which migration 54
-- already recorded, not the search. Elasticsearch would move none of that.
-- Everything below stays inside the database the rest of the product trusts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The normaliser
--
-- Same name and signature, so the generated column and everything else that
-- calls it keeps working. What changes, and why each is safe:
--
--   NFKC first      Arabic presentation forms — what a PDF or a Word export
--                   pastes: ﻻ, ﺍ, ﻣ — become the letters they are drawn from.
--                   Also turns no-break and other exotic spaces into spaces.
--   format chars    RLM, LRM, ALM, ZWJ, ZWNJ, BOM and the bidi embeddings.
--                   Invisible, and a copy from a web page carries them.
--   harakat         The whole combining block U+064B–U+065F, plus superscript
--                   alef and tatweel. Migration 23 stopped at U+0652 in SQL
--                   and went to U+065F in TypeScript — a disagreement the
--                   parity test's corpus never exercised.
--   hamza seats     ؤ and ئ both fold to ء. Not to و and ي as before: the
--                   variation people actually type is between the two seats
--                   (مسئول / مسؤول, رئيس is stable), and folding each to a
--                   different letter kept the two spellings apart.
--   ی and ک         The Persian yeh and keheh a Farsi or Urdu keyboard
--                   produces for ي and ك. Same letter, different code point.
--   ة → ه           Kept, deliberately. Orthographically ة only occurs at
--                   the end of a word, so this is a word-final fold and not
--                   a general ه/ة merge; and Egyptian typing writes مدينه
--                   for مدينة more often than not. The pair of real words it
--                   could merge is vanishingly small next to the listings it
--                   would otherwise miss.
--   ى → ي           Kept. Egyptian writing uses ى for final ي as a rule, not
--                   a mistake: استشارى is how the word is spelled here.
--   whitespace      Collapsed, and trimmed, in SQL too — the TypeScript side
--                   always did, and the two are asserted equal.
-- ---------------------------------------------------------------------------

create or replace function public.ar_normalise(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
  select btrim(
    regexp_replace(
      lower(
        translate(
          regexp_replace(
            normalize(input, NFKC),
            '[ً-ٰٟـ؜​-‏‪-‮⁦-⁩﻿]',
            '',
            'g'
          ),
          '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹آأإٱىیکةؤئ',
          '01234567890123456789ااااييكهءء'
        )
      ),
      '[ \t\n\r\f\v]+',
      ' ',
      'g'
    ),
    ' '
  );
$$;

-- ---------------------------------------------------------------------------
-- The article, and the article behind a one-letter prefix.
--
-- و, ف, ب and ك attach to the word in front of them, and ل + ال is written
-- لل. So المبيعات in a title is والمبيعات in a sentence and للمبيعات in a
-- heading, and stripping only a bare leading ال left all of those unfound.
--
-- Still only where at least three letters are left behind, which is what
-- keeps ال, الا, والي and فالح as the words they are. And a word boundary is
-- now "anything that is not an Arabic letter" rather than whitespace, so
-- (المعادي) and «التجمع» lose their article like any other word does.
-- ---------------------------------------------------------------------------

create or replace function public.ar_strip_al(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
  select regexp_replace(
    input,
    '(^|[^ء-ي])(?:[وفبك]?ال|لل)([ء-ي]{3,})',
    '\1\2',
    'g'
  );
$$;

-- ar_search_text() is unchanged: it still indexes the written form and the
-- stripped form side by side. Restated only so its SET clause survives — see
-- migration 49 for what CREATE OR REPLACE does to one that is left out.
create or replace function public.ar_search_text(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when public.ar_strip_al(public.ar_normalise(input)) = public.ar_normalise(input)
      then public.ar_normalise(input)
    else public.ar_normalise(input) || ' ' || public.ar_strip_al(public.ar_normalise(input))
  end;
$$;

-- A stored generated column is computed on write, so a changed function
-- leaves every existing row folded the old way. Rebuilt, as migration 23 did.
--
-- Kept, not dropped: the board falls back to it when the code reaches a
-- database this migration has not reached yet. Remove it in a later migration
-- once no deployed code names it.
drop index if exists jobs_search_idx;
alter table jobs drop column if exists search_vector;

alter table jobs add column search_vector tsvector
  generated always as (
    to_tsvector('simple',
      public.ar_search_text(
        coalesce(title_ar, '') || ' ' ||
        coalesce(title_en, '') || ' ' ||
        coalesce(description_ar, '')
      )
    )
  ) stored;

create index jobs_search_idx on jobs using gin (search_vector);

-- ---------------------------------------------------------------------------
-- 2. Aliases — what people call a place or a specialisation, as data
--
-- The taxonomy's own names are always searchable; this table holds only what
-- the names do not already say. «القاهرة الجديدة» is what the district this
-- board calls «التجمع الخامس» is called in English and on every developer's
-- brochure; «ريسيل» is how a resale broker in Cairo says what they do.
--
-- Rows, not a list in code, so adding one is an insert rather than a deploy,
-- and a foreign key rather than a slug, so an alias cannot point at a
-- district that does not exist or outlive one that is removed. Seeded in
-- seed.sql, beside the taxonomy it describes — see the rule written there
-- for what belongs in it.
-- ---------------------------------------------------------------------------

create table if not exists search_aliases (
  id              serial primary key,
  alias           text not null check (length(btrim(alias)) between 2 and 80),
  district_id     int references districts on delete cascade,
  governorate_id  int references governorates on delete cascade,
  track           job_track,
  created_at      timestamptz not null default now(),

  -- Exactly one thing is being named.
  constraint search_aliases_one_target
    check (num_nonnulls(district_id, governorate_id, track) = 1),
  constraint search_aliases_unique
    unique nulls not distinct (district_id, governorate_id, track, alias)
);

comment on table search_aliases is
  'Extra names for a district, governorate or track. Taxonomy names are searchable without a row here.';

create index if not exists search_aliases_district_idx
  on search_aliases (district_id) where district_id is not null;
create index if not exists search_aliases_governorate_idx
  on search_aliases (governorate_id) where governorate_id is not null;

alter table search_aliases enable row level security;

-- Public, like the taxonomy: the board reads it to recognise place names in a
-- query, and there is nothing in it that is not already on the page.
create policy search_aliases_read on search_aliases
  for select using (true);

create policy search_aliases_admin on search_aliases
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. One search document per listing
--
-- The district, the company and the track live in other tables, and a
-- generated column cannot read another table. So the document is a row of
-- its own, kept current by triggers, rather than a column on jobs.
--
-- Not a trigger-maintained column on jobs, which was the obvious shape and is
-- wrong here: every UPDATE of jobs bumps `version` (migration 50), so
-- rewriting the search column when a company is renamed would tell everyone
-- with that company's listing open in an editor that somebody else had just
-- saved it. A separate row leaves the listing itself untouched.
--
-- Weighted by where a word came from, so the query can treat the fields
-- differently (see buildJobQuery in src/lib/search/arabic.ts):
--
--   A  the title
--   B  the specialisation and the place — names and aliases
--   C  the company and the developers the role sells
--   D  the description
--
-- A–C are short and chosen from lists; a prefix match there is what people
-- mean. D is prose, where a prefix match on مبيع is a match on every listing
-- on the board, so the description is matched on whole words only.
-- ---------------------------------------------------------------------------

create table if not exists job_search_documents (
  job_id        uuid primary key references jobs on delete cascade,
  document      tsvector not null,
  refreshed_at  timestamptz not null default now()
);

create index if not exists job_search_documents_idx
  on job_search_documents using gin (document);

alter table job_search_documents enable row level security;

/*
  Only public listings have a document, so the table is public.

  The first version of this policy inherited the listing's visibility —
  `exists (select 1 from jobs where id = job_id)`, the job_developers pattern —
  and measured, it made the GIN index unusable. A policy is a security
  barrier, `@@` is not a leakproof operator, and Postgres will not evaluate a
  non-leakproof condition ahead of a barrier, so it cannot turn the search into
  an index lookup. At 20,000 listings a rare word read every live listing one
  by one: 786 ms to return nothing, against 1–3 ms for the same search with
  the index in play.

  So the rule moved from the policy into the data. refresh_job_search() writes
  a document only for a listing everyone may already read — active, expired or
  closed, the statuses jobs_select_active shows to anon — and deletes it the
  moment the listing leaves them. A draft, a listing waiting for review and a
  rejected one have no document at all, so there is nothing here to hide and
  `true` is an accurate policy rather than a lax one. The board still reads
  through jobs, whose own policies apply to every row it returns.
*/
create policy job_search_documents_select on job_search_documents
  for select using (true);

-- Written only by the definer function below. No insert, update or delete
-- policy exists, and the grants say the same thing a second way.
revoke insert, update, delete, truncate on job_search_documents from anon, authenticated;

create or replace function public.refresh_job_search(p_job_ids uuid[] default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- A listing that is not public, or no longer exists, has no document.
  delete from job_search_documents s
   where (p_job_ids is null or s.job_id = any (p_job_ids))
     and not exists (
       select 1 from jobs j
        where j.id = s.job_id
          and j.status in ('active', 'expired', 'closed')
     );

  insert into job_search_documents (job_id, document, refreshed_at)
  select
    j.id,
       setweight(to_tsvector('simple', public.ar_search_text(
         concat_ws(' ', j.title_ar, j.title_en))), 'A')
    || setweight(to_tsvector('simple', public.ar_search_text(
         coalesce(ta.aliases, ''))), 'B')
    -- District before governorate, so «مصر الجديدة» followed by «القاهرة»
    -- cannot line up into the phrase «القاهرة الجديدة» that means somewhere
    -- else. The order matters because phrases match on adjacent positions.
    || setweight(to_tsvector('simple', public.ar_search_text(
         concat_ws(' ', d.name_ar, d.name_en, da.aliases, g.name_ar, g.name_en, ga.aliases))), 'B')
    || setweight(to_tsvector('simple', public.ar_search_text(
         concat_ws(' ', c.name_ar, c.name_en, dv.names))), 'C')
    || setweight(to_tsvector('simple', public.ar_search_text(
         coalesce(j.description_ar, ''))), 'D'),
    now()
  from jobs j
  join companies c    on c.id = j.company_id
  join districts d    on d.id = j.district_id
  join governorates g on g.id = d.governorate_id
  left join lateral (
    select string_agg(a.alias, ' ' order by a.id) as aliases
      from search_aliases a where a.track = j.track
  ) ta on true
  left join lateral (
    select string_agg(a.alias, ' ' order by a.id) as aliases
      from search_aliases a where a.district_id = d.id
  ) da on true
  left join lateral (
    select string_agg(a.alias, ' ' order by a.id) as aliases
      from search_aliases a where a.governorate_id = g.id
  ) ga on true
  left join lateral (
    select string_agg(concat_ws(' ', v.name_ar, v.name_en), ' ' order by v.id) as names
      from job_developers jd
      join developers v on v.id = jd.developer_id
     where jd.job_id = j.id
  ) dv on true
  where (p_job_ids is null or j.id = any (p_job_ids))
    and j.status in ('active', 'expired', 'closed')
  on conflict (job_id) do update
    set document = excluded.document,
        refreshed_at = excluded.refreshed_at;
end;
$$;

-- Not an API. Rebuilding documents is harmless, but nothing outside the
-- triggers has a reason to ask for it.
revoke execute on function public.refresh_job_search(uuid[]) from public, anon, authenticated;

-- The listing's own fields, and its status — publishing creates the document,
-- going back to review removes it. Only these columns, so a view counted or a
-- version bump costs nothing here.
create or replace function public.job_search_from_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_job_search(array[new.id]);
  return null;
end;
$$;

drop trigger if exists jobs_50_search_document on jobs;
create trigger jobs_50_search_document
  after insert or update of title_ar, title_en, description_ar, track, district_id, company_id, status
  on jobs
  for each row execute function public.job_search_from_job();

-- The developers a listing is tagged with.
create or replace function public.job_search_from_developers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- On a delete that is part of deleting the listing, the listing is already
  -- gone and this refreshes nothing — the document goes with it by cascade.
  perform public.refresh_job_search(array[coalesce(new.job_id, old.job_id)]);
  return null;
end;
$$;

drop trigger if exists job_developers_search_document on job_developers;
create trigger job_developers_search_document
  after insert or update or delete on job_developers
  for each row execute function public.job_search_from_developers();

-- A company renamed is a company searched for by its new name.
create or replace function public.job_search_from_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_job_search(
    array(select j.id from jobs j where j.company_id = new.id)
  );
  return null;
end;
$$;

drop trigger if exists companies_50_search_document on companies;
create trigger companies_50_search_document
  after update of name_ar, name_en on companies
  for each row execute function public.job_search_from_company();

/*
  The taxonomy and its aliases: only the listings a row actually names.

  Rebuilding every document on any taxonomy edit was the first version, and it
  measured at 14–25 s for 20,000 listings in the bench (PGlite; a few seconds
  on a real instance) — too long to hang off an admin adding one alias. So
  each change rebuilds what it can reach: a district's listings, a
  governorate's districts' listings, a track's listings, a developer's tagged
  listings. One district alias over ~900 listings measured about a second.
*/
create or replace function public.job_search_from_taxonomy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids uuid[];
begin
  if tg_table_name = 'districts' then
    select array_agg(j.id) into ids from jobs j
     where j.district_id in (coalesce(new.id, old.id));
  elsif tg_table_name = 'governorates' then
    select array_agg(j.id) into ids from jobs j
      join districts d on d.id = j.district_id
     where d.governorate_id in (coalesce(new.id, old.id));
  elsif tg_table_name = 'developers' then
    select array_agg(jd.job_id) into ids from job_developers jd
     where jd.developer_id in (coalesce(new.id, old.id));
  elsif tg_table_name = 'search_aliases' then
    select array_agg(j.id) into ids from jobs j
      join districts d on d.id = j.district_id
     where j.district_id in (new.district_id, old.district_id)
        or d.governorate_id in (new.governorate_id, old.governorate_id)
        or j.track in (new.track, old.track);
  end if;

  if ids is not null then
    perform public.refresh_job_search(ids);
  end if;
  return null;
end;
$$;

drop trigger if exists districts_search_document on districts;
create trigger districts_search_document
  after update of name_ar, name_en, governorate_id on districts
  for each row execute function public.job_search_from_taxonomy();

drop trigger if exists governorates_search_document on governorates;
create trigger governorates_search_document
  after update of name_ar, name_en on governorates
  for each row execute function public.job_search_from_taxonomy();

drop trigger if exists developers_search_document on developers;
create trigger developers_search_document
  after update of name_ar, name_en on developers
  for each row execute function public.job_search_from_taxonomy();

drop trigger if exists search_aliases_search_document on search_aliases;
create trigger search_aliases_search_document
  after insert or update or delete on search_aliases
  for each row execute function public.job_search_from_taxonomy();

revoke execute on function public.job_search_from_job()        from public, anon, authenticated;
revoke execute on function public.job_search_from_developers() from public, anon, authenticated;
revoke execute on function public.job_search_from_company()    from public, anon, authenticated;
revoke execute on function public.job_search_from_taxonomy()   from public, anon, authenticated;

-- Every listing that exists today.
select public.refresh_job_search(null);

-- ---------------------------------------------------------------------------
-- 4. Companies, by a name however it was typed
--
-- The directory matched `name_ar ilike '%…%'`, so الأهرام was not found by
-- الاهرام, and «الرواد للتطوير» was not found by «رواد تطوير». A folded copy of
-- both names, searched word by word, fixes both. No trigram index: the
-- directory lists companies with a live listing, which is a few hundred rows
-- at most, and a sequential scan of those is faster than maintaining one.
-- ---------------------------------------------------------------------------

alter table companies add column if not exists search_name text
  generated always as (
    public.ar_search_text(coalesce(name_ar, '') || ' ' || coalesce(name_en, ''))
  ) stored;

-- ---------------------------------------------------------------------------
-- 5. The agent directory, by keyword — and never by what the viewer may not see
--
-- The directory had filters and no search box. An employer looking for
-- "Resale Sheikh Zayed" or «مدير مبيعات» had to guess which filters that was.
--
-- What is searched is exactly what the card shows to the person asking:
--
--   the headline, which every card shows;
--   the name, only where the card would show the name — a public profile,
--   or a viewer the gate lets through.
--
-- Searching a gated name for somebody who cannot see it would be a way to
-- find out who is in the directory one guess at a time: the count on the
-- page would answer "is there a consultant called …" without ever printing
-- the name. A hidden profile matches nothing, as before, because it never
-- reaches the match at all.
--
-- Matched as substrings of the folded text, word by word, rather than through
-- a tsvector: a headline is a line, the directory is thousands of rows at the
-- very most, and the name has to be included or excluded per viewer, which an
-- index cannot know in advance.
--
-- The folded text is stored, not computed per query. Folding in the query
-- measured 535 ms for a keyword over 5,000 consultants, against 10 ms for the
-- same page with no keyword: the regular expressions ran once per row per
-- search. Generated columns move that cost to the write, where it happens
-- once; the same keyword then measured about 50 ms.
--
-- The new parameter goes last with a default, so every existing positional
-- call keeps meaning what it meant. The old signature is dropped first, or
-- PostgREST would find two candidates for a call that omits p_q.
-- ---------------------------------------------------------------------------

alter table agent_profiles add column if not exists search_headline text
  generated always as (
    public.ar_search_text(coalesce(headline_ar, '') || ' ' || coalesce(headline_en, ''))
  ) stored;

alter table profiles add column if not exists search_name text
  generated always as (public.ar_search_text(full_name)) stored;

drop function if exists public.search_agents(job_track[], int[], agent_availability, int, int, int);

create or replace function public.search_agents(
  p_tracks       job_track[] default null,
  p_district_ids int[]       default null,
  p_availability agent_availability default null,
  p_min_years    int         default null,
  p_limit        int         default 24,
  p_offset       int         default 0,
  p_q            text        default null
)
returns table (
  id               uuid,
  slug             text,
  is_unlocked      boolean,
  full_name        text,
  avatar_url       text,
  headline_ar      text,
  headline_en      text,
  years_experience int,
  tracks           job_track[],
  district_ids     int[],
  languages        text[],
  availability     agent_availability,
  total_count      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select (public.viewer_has_verified_company() or public.is_admin()) as unlocked
  ),
  needles as (
    -- At most eight words, each folded the way the text is.
    select array(
      select w
        from unnest(string_to_array(
               public.ar_strip_al(public.ar_normalise(left(coalesce(p_q, ''), 120))), ' ')) as w
       where w <> ''
       limit 8
    ) as words
  ),
  matched as (
    select a.*, p.full_name, p.avatar_url,
           (a.visibility = 'public' or v.unlocked) as shows_name
      from agent_profiles a
      join profiles p on p.id = a.user_id
      cross join viewer v
      cross join needles n
     where a.visibility <> 'hidden'
       and p.role = 'candidate'
       and (p_tracks       is null or a.tracks && p_tracks)
       and (p_district_ids is null or a.district_ids && p_district_ids)
       and (p_availability is null or a.availability = p_availability)
       and (p_min_years    is null or a.years_experience >= p_min_years)
       and (
         cardinality(n.words) = 0
         or not exists (
           select 1
             from unnest(n.words) as w
            where strpos(
                    concat_ws(' ',
                      a.search_headline,
                      case when a.visibility = 'public' or v.unlocked then p.search_name end),
                    w) = 0
         )
       )
  )
  select
    m.id,
    m.slug,
    m.shows_name                                  as is_unlocked,
    case when m.shows_name then m.full_name  end  as full_name,
    case when m.shows_name then m.avatar_url end  as avatar_url,
    m.headline_ar,
    m.headline_en,
    m.years_experience,
    m.tracks,
    m.district_ids,
    m.languages,
    m.availability,
    count(*) over ()                              as total_count
  from matched m
  order by m.years_experience desc, m.created_at desc, m.id
  limit greatest(1, least(p_limit, 60)) offset greatest(0, p_offset);
$$;

-- The public API, as before: the directory is read by signed-out visitors.
grant execute on function public.search_agents(job_track[], int[], agent_availability, int, int, int, text)
  to anon, authenticated;
