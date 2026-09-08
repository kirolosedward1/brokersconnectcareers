-- =============================================================================
-- 23 — Arabic search missed the obvious match
--
-- search_vector was to_tsvector('simple', …), which does no stemming and no
-- folding. In Arabic that means ordinary spelling variation breaks matching:
-- a listing in المعادي is not found by معادي, مُهندس written with harakat is
-- not found by مهندس without them, and استشارى typed with a dotless ya is not
-- found by استشاري.
--
-- Fifteen listings hide this. Five hundred will not, and it will read as
-- "your search is broken" rather than as something to tune.
--
-- What this does NOT do is pretend to stem. شقة and شقق are a broken plural;
-- no character fold connects them, and a hand-rolled stemmer would quietly
-- merge words that are genuinely different. Postgres ships no Arabic
-- dictionary, so that stays unsolved rather than badly solved.
--
-- The same folding exists in src/lib/search/arabic.ts, because one side runs
-- on the query and this one runs inside a generated column. A database test
-- feeds one corpus through both and asserts they agree, so the pair cannot
-- drift apart without something saying so.
-- =============================================================================

-- IMMUTABLE, and it genuinely is: same input, same output, no reads. A
-- generated column will not accept anything less.
create or replace function public.ar_normalise(input text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select lower(
    -- Arabic-Indic and Extended Arabic-Indic digits, then the letter folds.
    translate(
      -- Harakat (U+064B..U+0652), superscript alef (U+0670) and tatweel.
      regexp_replace(input, '[ً-ْٰـ]', '', 'g'),
      '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹آأإٱىةؤئ',
      '01234567890123456789اااايهوي'
    )
  );
$$;

-- The leading ال, dropped only where a word is left behind: ال alone, and الا,
-- are words rather than an article plus a noun.
create or replace function public.ar_strip_al(input text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select regexp_replace(input, '(^|\s)ال(\S{3,})', '\1\2', 'g');
$$;

-- Both forms, so matching works in both directions: a listing written المعادي
-- is found by معادي, and one written معادي is found by المعادي.
create or replace function public.ar_search_text(input text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select case
    when public.ar_strip_al(public.ar_normalise(input)) = public.ar_normalise(input)
      then public.ar_normalise(input)
    else public.ar_normalise(input) || ' ' || public.ar_strip_al(public.ar_normalise(input))
  end;
$$;

-- Dropping the generated column takes its index with it, so both come back.
-- Recomputed for every row on the way in, which is the whole cost of this
-- migration and is trivial at the volumes involved.
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
