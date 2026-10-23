-- =============================================================================
-- 359 — The specialisations by the market's words
--
-- Four of the six specialisations are labelled as brokers say them now:
-- «بيع أوف بلان», «ريسيل», «تجاري وإداري» and «باك أوفيس» ("Commercial &
-- administrative" in English). Only the labels move: the enum values, the
-- `?track=` links and every stored listing and saved search stay as they
-- are. The earlier labels stay search aliases, since people still type them;
-- these rows teach search the new ones, as seed.sql does on a new database
-- (supabase/tests/search.test.mjs holds 342, 358 and this to the seed).
-- Inserting a row refreshes the search documents of the listings it names
-- (search_aliases_search_document, migration 68).
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back.
-- =============================================================================

-- rollback: delete from search_aliases where track is not null and alias in ('بيع أوف بلان', 'أوف بلان', 'تجاري وإداري', 'إداري وتجاري', 'Commercial & administrative', 'باك أوفيس') — rows only; the trigger refreshes the listings they named
-- safety: ships-with-code — rows the search already reads (migration 68), inserted with on conflict do nothing; no code waits for them

insert into search_aliases (track, alias)
select a.track::job_track, a.alias
from (values
  ('primary',     'بيع أوف بلان'),
  ('primary',     'أوف بلان'),
  ('commercial',  'تجاري وإداري'),
  ('commercial',  'إداري وتجاري'),
  ('commercial',  'Commercial & administrative'),
  ('back_office', 'باك أوفيس')
) as a(track, alias)
on conflict on constraint search_aliases_unique do nothing;
