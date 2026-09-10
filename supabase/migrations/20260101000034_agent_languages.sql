-- =============================================================================
-- 34 — Languages are the three the product offers
--
-- `languages text[]` took anything. Both writers are fixed checkbox lists, so
-- in practice it holds 'ar', 'en' and 'fr' — but "in practice" is not a rule a
-- renderer can rely on, and the public profile page was written as a ternary
-- over two of them: a consultant who ticked French had their badge render the
-- string "fr". Seven profiles list it today.
--
-- Naming them here makes the mapping in the UI total rather than hopeful, and
-- matches how the benefits array on jobs is already constrained.
-- =============================================================================

alter table agent_profiles
  add constraint agent_languages_allowed
  check (languages <@ array['ar', 'en', 'fr']::text[]);
