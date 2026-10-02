-- =============================================================================
-- 343 — Indexes a delete can use
--
-- Deleting a row looks up every row that points at it, to cascade, clear or
-- refuse. Two foreign keys had only a partial index, which that lookup cannot
-- use because it leaves rows out:
--
--   push_devices (user_id)  indexed for active phones only (migration 329).
--                           Deleting an account read every phone ever
--                           registered, and disabled ones are never pruned.
--   jobs (district_id)      indexed for live listings only (migration 30).
--                           Removing a district from the taxonomy read the
--                           whole of jobs to find closed listings still in it.
--
-- supabase/tests/schema.test.mjs now counts a partial index only when its
-- condition is the key being there; these were the two it found.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: drop index if exists public.push_devices_user_idx; drop index if exists public.jobs_district_idx;
-- safety: ships-with-code — two indexes on small tables (production on 2026-10-02: no phones registered, 18 listings); no code reads or names them

create index if not exists push_devices_user_idx on push_devices (user_id);
create index if not exists jobs_district_idx on jobs (district_id);
