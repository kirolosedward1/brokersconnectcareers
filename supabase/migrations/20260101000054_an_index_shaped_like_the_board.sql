-- =============================================================================
-- 54 — The board's own order, measured
--
-- The public board reads `status = 'active' and expires_at > now()` and orders
-- by `is_featured desc, published_at desc, id desc`. jobs_featured_idx is
-- `(is_featured, published_at desc) where status = 'active'` — close, and not
-- close enough: the query wants is_featured descending, so the planner can only
-- use it as a presorted key on that one column and sorts everything inside each
-- group. With two thousand listings it read 2014 rows to return 20.
--
-- Measured on production, in a rolled-back transaction with 2000 listings
-- inserted:
--
--   before   Incremental Sort over Index Scan, 2014 rows read      80 ms
--   after    Index Scan, 20 rows read                               2 ms
--   filtered by track, after                                        3 ms
--
-- The row-level security filter stops mattering at the same time. It calls
-- owns_company() and applied_to_job() per row, and the planner will not reorder
-- an OR by cost — raising the declared cost of both functions to 10000 changed
-- the plan not at all, which is worth writing down because it is the obvious
-- thing to try. What changes it is not reading two thousand rows.
--
-- Not added, and measured rather than guessed: the salary and seats sorts still
-- cost about 75 ms at the same size, because each wants its own key order. They
-- are opt-in — the default sort is what a visitor lands on — and an index per
-- sort is three more to maintain on every write for a minority of views. The
-- numbers are here so the decision can be revisited on traffic rather than on
-- instinct.
--
-- jobs_featured_idx is left in place. This index supersedes it for the board's
-- order, but it still serves an is_featured prefix lookup, it costs 16 kB, and
-- dropping it would change plans I have not measured.
-- =============================================================================

create index if not exists jobs_board_order_idx
  on jobs (is_featured desc, published_at desc, id desc)
  where status = 'active';
