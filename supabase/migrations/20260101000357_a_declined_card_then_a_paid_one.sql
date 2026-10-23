-- =============================================================================
-- 357 — A declined card then a paid one
--
-- settle_order() (migration 312) treated `failed` as final: the first
-- unsuccessful callback for an order moved it to `failed`, and every callback
-- after that answered `already_failed`. But one Paymob order can carry several
-- transactions. A buyer whose card is declined in the iframe tries again with
-- the same payment key, the second attempt succeeds, and Paymob sends its
-- callback for the same Paymob order id. The money was taken and the company
-- got no credits.
--
-- Only `paid` is final now. A success settles an order that is `pending`, or
-- `failed` when the failure was recorded against the same signed Paymob order
-- id the success carries; every other check (amount, currency, order id) is
-- unchanged. A failure never touches an order that is already `failed` or
-- `paid`.
--
-- The webhook (src/app/api/paymob/webhook/route.ts) also stops sending a
-- callback whose transaction is still `pending` (wallets, kiosk) as a failure.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: restate settle_order(uuid, text, boolean, bigint, text) from 20260101000312_a_payment_is_settled_against_itself.sql (same signature, `create or replace`).
-- safety: ships-with-code — same signature and the same answers for every call the old webhook makes (pending order, paid order, mismatches); the only new answer is 'paid' for a failed order whose signed Paymob order id matches, which either webhook version passes through as-is. The webhook's own changes (the `pending` HMAC field, skipping pending transactions) call nothing new in the database.

create or replace function public.settle_order(
  p_order_id        uuid,
  p_paymob_order_id text,
  p_success         boolean,
  p_amount_cents    bigint default null,
  p_currency        text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order orders;
begin
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    return 'unknown_order';
  end if;

  if v_order.status = 'paid' then
    return 'already_paid';
  end if;

  -- A failure is recorded once; a later failure changes nothing.
  if v_order.status <> 'pending' and not p_success then
    return 'already_' || v_order.status;
  end if;

  -- A success may settle a failed order only when the failure was recorded
  -- against the same signed Paymob order: the retry on one payment key.
  if v_order.status <> 'pending'
     and not (v_order.status = 'failed'
              and v_order.paymob_order_id is not null
              and v_order.paymob_order_id = p_paymob_order_id) then
    return 'already_' || v_order.status;
  end if;

  -- The signed transaction has to be about this order.
  if v_order.paymob_order_id is not null
     and v_order.paymob_order_id is distinct from p_paymob_order_id then
    return 'order_mismatch';
  end if;
  if p_amount_cents is not null and p_amount_cents <> v_order.amount_egp::bigint * 100 then
    return 'amount_mismatch';
  end if;
  if p_currency is not null and upper(p_currency) <> 'EGP' then
    return 'currency_mismatch';
  end if;

  if not p_success then
    update orders
       set status = 'failed',
           paymob_order_id = coalesce(p_paymob_order_id, paymob_order_id)
     where id = p_order_id;
    return 'failed';
  end if;

  update orders
     set status = 'paid',
         paymob_order_id = coalesce(p_paymob_order_id, paymob_order_id)
   where id = p_order_id;

  update companies
     set post_credits = post_credits + v_order.credits
   where id = v_order.company_id;

  return 'paid';
end;
$$;

revoke execute on function public.settle_order(uuid, text, boolean, bigint, text) from public, anon, authenticated;
grant  execute on function public.settle_order(uuid, text, boolean, bigint, text) to service_role;
