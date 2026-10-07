-- =============================================================================
-- 342 — The names people search by
--
-- Migration 68 taught search the other names of a place and a specialisation
-- (search_aliases), and seed.sql filled them in: «القاهرة الجديدة», "Fifth
-- Settlement" and "Tagamoa" for New Cairo, «ريسيل» and «إعادة بيع» for resale,
-- and so on. Production's taxonomy was seeded before that, and seed.sql was not
-- run there again, so production has none of them: a search for «القاهرة
-- الجديدة» finds no listing in New Cairo unless its own text says so. Every
-- governorate, district and developer the seed names is there (checked
-- read-only on 2026-10-02); only these 25 rows are missing.
--
-- The same rows as seed.sql, so a database that takes its migrations gets
-- them. seed.sql keeps them as well: on a new database the migrations run
-- before the seed, so the districts these name do not exist yet when this
-- runs, and the seed puts them in after. supabase/tests/search.test.mjs checks
-- that the two lists are the same. Inserting a row refreshes the search
-- documents of the listings it names (search_aliases_search_document,
-- migration 68), so no listing needs touching.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: delete from search_aliases where alias in (the 25 aliases below) — rows only; the trigger refreshes the listings they named
-- safety: ships-with-code — rows the search already reads (migration 68), inserted with on conflict do nothing; no code waits for them

insert into search_aliases (district_id, alias)
select d.id, a.alias
from (values
  ('new-cairo',      'القاهرة الجديدة'),
  ('new-cairo',      'Fifth Settlement'),
  ('new-cairo',      '5th Settlement'),
  ('new-cairo',      'Tagamoa'),
  ('new-capital',    'العاصمة الإدارية الجديدة'),
  ('new-capital',    'New Administrative Capital'),
  ('6th-of-october', 'السادس من أكتوبر'),
  ('6th-of-october', '6 October'),
  ('north-coast',    'Sahel'),
  ('mohandessin',    'Mohandeseen'),
  ('mokattam',       'Moqattam')
) as a(slug, alias)
join districts d on d.slug = a.slug
on conflict on constraint search_aliases_unique do nothing;

insert into search_aliases (track, alias)
select a.track::job_track, a.alias
from (values
  ('primary',             'بيع أول'),
  ('primary',             'Primary sales'),
  ('primary',             'برايمري'),
  ('resale',              'إعادة بيع'),
  ('resale',              'Resale'),
  ('resale',              'ريسيل'),
  ('rental',              'إيجارات'),
  ('rental',              'Rentals'),
  ('commercial',          'عقارات تجارية'),
  ('commercial',          'Commercial'),
  ('property_management', 'إدارة أملاك'),
  ('property_management', 'Property management'),
  ('back_office',         'دعم ومساندة'),
  ('back_office',         'Back office')
) as a(track, alias)
on conflict on constraint search_aliases_unique do nothing;
