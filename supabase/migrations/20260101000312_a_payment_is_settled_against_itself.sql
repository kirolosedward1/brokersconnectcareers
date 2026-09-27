-- =============================================================================
-- 312 — A payment is settled against itself
--
-- settle_order() trusted the callback's merchant_order_id, and that is the
-- one field in Paymob's callback its HMAC does not cover. A buyer holds a
-- valid signature for their own transaction — Paymob's browser redirect
-- carries the same fields and the same hmac — so a signed body could be
-- replayed with a different pending order in it. The partial unique index on
-- paymob_order_id was the only thing refusing the second settlement, and it
-- was added for a different reason.
--
-- The settlement now insists that the signed facts match the order: the
-- Paymob order id the checkout recorded, the amount in piastres, and the
-- currency. A callback whose signed transaction does not describe this order
-- settles nothing and says why. The older signature stays callable for the
-- migration window; the route passes the new arguments.
-- =============================================================================

-- rollback: drop function if exists public.settle_order(uuid, text, boolean, bigint, text); restate the three-argument settle_order(uuid, text, boolean) from its previous migration;
-- safety: ships-with-code — the old webhook's three-argument call still resolves through
--   the two defaults, so old code keeps settling (without the amount check) after this
--   runs; new code against the old schema finds no matching function and answers 500
--   to Paymob, which retries, until this runs. Apply the migration first.

-- The old three-argument signature would make every call ambiguous beside the
-- new one, so it goes first; the new one carries defaults for the same call.
drop function if exists public.settle_order(uuid, text, boolean);

create function public.settle_order(
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

  if v_order.status <> 'pending' then
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
