-- =============================================================================
-- 357 — The first-sale track, found by its new name
--
-- The track that read «بيع أول» / "Primary sales" now reads «عقارات قيد
-- الإنشاء» / "Off-plan" (messages/*.json), and seed.sql gained the names that
-- go with it: «عقارات قيد الإنشاء», «قيد الإنشاء» and "Off-plan". The old names
-- stay aliases (migration 342) because the market still says them. A database
-- that takes its migrations, production among them, had only the old ones, so
-- a search for "Off-plan" found no first-sale listing unless its own text said
-- so. These are the three rows seed.sql added; supabase/tests/search.test.mjs
-- checks that 342 and this file together give the seed's list exactly.
--
-- Inserting a row refreshes the search documents of the listings it names
-- (search_aliases_search_document, migration 68), so no listing needs touching.
-- =============================================================================

-- rollback: delete from search_aliases where track = 'primary' and alias in ('عقارات قيد الإنشاء', 'قيد الإنشاء', 'Off-plan') — rows only; the trigger refreshes the listings they named
-- safety: ships-with-code — rows the search already reads (migration 68), inserted with on conflict do nothing; no code waits for them

insert into search_aliases (track, alias)
select a.track::job_track, a.alias
from (values
  ('primary', 'عقارات قيد الإنشاء'),
  ('primary', 'قيد الإنشاء'),
  ('primary', 'Off-plan')
) as a(track, alias)
on conflict on constraint search_aliases_unique do nothing;
