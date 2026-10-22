-- =============================================================================
-- 353 — A payment outlives the company
--
-- docs/data-lifecycle.md says an order is "Retained" and its deletion
-- "Refused while the company exists". The table said otherwise: orders.company_id
-- was `on delete cascade`, so the one statement that removes a company — an
-- admin's delete through companies_admin_all, the dashboard's table editor,
-- remove-demo.sql — removed every order the company had paid for with it,
-- silently. An order is the platform's record that somebody paid it money:
-- the receipt a refund dispute, a chargeback or the tax authority asks for,
-- long after the company has gone.
--
-- Migration 203 gave the recruitment history the same rule for the same
-- reason (applications.job_id, companies.owner_id): what happens to it is a
-- decision somebody makes on purpose, not a side effect. So the key restricts.
-- Deleting a company that has orders is now refused by the database, whatever
-- path asks; a company with none is deleted exactly as before.
--
-- Monthly free-post grants keep their cascade: they are the platform's own
-- gift, nobody paid for them, and any company that ever claimed one would
-- otherwise become undeletable for a spam clean-up.
--
-- Compatibility: no product path deletes a company (data-lifecycle.md), and
-- production holds no order (checked 2026-10-16), so nothing that runs today
-- meets the new refusal. remove-demo.sql removes a demo company's orders
-- first, on purpose, before the company.
-- =============================================================================

-- rollback: alter table orders drop constraint orders_company_id_fkey, add constraint orders_company_id_fkey foreign key (company_id) references companies (id) on delete cascade;
-- safety: constraint — the key is re-created on the same column with the same target, only its delete rule changes; every existing row already satisfies it (it is the same reference), production has no order (checked 2026-10-16), so the validating scan finds nothing to check

alter table orders
  drop constraint if exists orders_company_id_fkey,
  add  constraint orders_company_id_fkey
       foreign key (company_id) references companies (id) on delete restrict;
