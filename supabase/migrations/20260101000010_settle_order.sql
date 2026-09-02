-- =============================================================================
-- 10 — Settling a payment
--
-- The whole risk in a payment integration is not taking the money; it is
-- granting what was bought more than once. Payment providers retry webhooks.
-- They retry on timeout, on a 500, and sometimes for no reason at all, and a
-- retry is indistinguishable from the first delivery unless something refuses
-- to act twice.
--
-- So the "did we already do this" question is answered in the database, inside
-- the same transaction that grants the credits, rather than in application
-- code where a second concurrent delivery could read "not yet paid" before the
-- first one writes.
-- =============================================================================

-- One Paymob order maps to at most one of ours. A partial index because our
-- pending rows have no provider id yet and must not collide with each other.
create unique index orders_paymob_order_id_idx
  on orders (paymob_order_id)
  where paymob_order_id is not null;

-- ---------------------------------------------------------------------------
-- settle_order
--
-- Returns what happened, so the caller can tell a first delivery from a
-- repeat and log accordingly — but every outcome is a success from the
-- provider's point of view. A webhook that gets an error back is a webhook
-- that will be sent again.
-- ---------------------------------------------------------------------------

create or replace function public.settle_order(
  p_order_id        uuid,
  p_paymob_order_id text,
  p_success         boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  -- FOR UPDATE: two simultaneous deliveries of the same webhook serialise
  -- here, and the second one sees the status the first one wrote.
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    return 'unknown_order';
  end if;

  -- Already decided. Say so and change nothing: this is the line that stops a
  -- retried webhook from granting a second pack of credits.
  if v_order.status <> 'pending' then
    return 'already_' || v_order.status;
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

  -- The credits themselves. companies.post_credits is guarded against its own
  -- owner; this runs as the function's owner, which the guard treats as
  -- billing rather than as the employer editing their own row.
  update companies
     set post_credits = post_credits + v_order.credits
   where id = v_order.company_id;

  return 'paid';
end;
$$;

-- Nobody signed in gets to call this. It settles payments and mints credits;
-- the only caller is the webhook handler, holding the service role.
revoke execute on function public.settle_order(uuid, text, boolean) from public;
revoke execute on function public.settle_order(uuid, text, boolean) from anon, authenticated;
grant  execute on function public.settle_order(uuid, text, boolean) to service_role;
