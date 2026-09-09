-- =============================================================================
-- 25 — A saved search could not hold the filters that produce it
--
-- saved_searches.query was capped at 500 characters and the action that writes
-- it accepts 2000, so the form let a candidate through and the database
-- refused them. Not a theoretical gap: run the real canonicaliser over every
-- filter the board offers and it returns 677 characters. The 21 districts
-- alone are 388, so "every district, every track" — an ordinary "show me
-- everything in Cairo" search — already exceeds it.
--
-- What the candidate got was a constraint violation surfaced as the generic
-- error, on the one action whose entire purpose is to be remembered.
--
-- Raised to 2000 so the column agrees with the schema that guards it. That
-- leaves zod as the limit a person actually meets and this as the backstop,
-- which is the right way round — and it still bounds the column, so nothing
-- unbounded is stored. The district list grows; 500 was going to be wrong
-- again even if it had been right today.
-- =============================================================================

alter table saved_searches drop constraint if exists saved_searches_query_check;

alter table saved_searches
  add constraint saved_searches_query_check check (length(query) <= 2000);
