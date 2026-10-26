-- =============================================================================
-- 358 — The first-sale track by its new name
--
-- The primary track's label became «عقارات قيد الإنشاء» ("Off-plan"), and
-- seed.sql gained the new wording as search aliases beside «بيع أول», which
-- stays because it is still what people type. Migration 342 carried the
-- seed's aliases to production, which never runs seed.sql; these three came
-- after it, so production would search the new label's words and find only
-- listings whose own text has them. The same rows as seed.sql;
-- supabase/tests/search.test.mjs checks 342 and this together against it.
-- Inserting a row refreshes the search documents of the listings it names
-- (search_aliases_search_document, migration 68).
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back.
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
