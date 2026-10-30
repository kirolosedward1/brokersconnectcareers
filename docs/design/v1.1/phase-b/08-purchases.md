# 08 · Packs, promoting a listing, checkout, orders, subscriptions

Boards: **Plans**, **PromoteListing**, **Checkout**, **Orders**,
**Subscription**.

## What exists

- Buying is on the **website**: `startCheckout({ packKey })` with
  `single | bulk | mass_hiring | featured_addon` from `PACKS_ON_SALE`. The
  price is never taken from the client. Orders are written with the service
  role, and employers have no insert policy on `orders`.
- The app's billing screen is **read-only**: credits, this month's free
  post for a verified company, and orders. Its own comment says "nothing is
  sold in the app".

## Decided: no in-app purchases

Buying stays on the website. The app keeps its read-only billing screen
(balance, free post, orders) and offers no purchase inside the app. Whether
it may point people to the website for buying follows the App Store rules
for each storefront. Until those are read, it does not. Options 2 and 3
below are kept for the record only.

## The App Store question (for the record)

Selling posting credits or promotion inside an iOS app falls under App
Review Guidelines section 3.1 (in-app purchase, and the rules for linking to
outside purchases). Those rules, and the storefront-specific exceptions, have
changed more than once. They must be read **as they stand on the day of the
decision**. This doc does not decide which rule applies.

Options:

1. **Keep purchases on the website (recommended until the rules are
   checked).** The app shows the balance and orders, as today. Whether it
   may mention or link to the website for buying depends on the rules in
   force for each storefront. That gets checked, not assumed.
2. **StoreKit in-app purchase** for packs and promotion. This needs App
   Store Connect products for each pack, server-side receipt validation (a
   new website route that verifies the App Store transaction and credits the
   company exactly once, keyed on the transaction id), refunds handled from
   App Store notifications, and prices that match the website or are
   explained. Apple's commission applies.
3. **Hybrid.** StoreKit where required, the website elsewhere.

## If option 2 is chosen: schema sketch

```sql
alter table orders
  add column channel text not null default 'web' check (channel in ('web','app_store')),
  add column store_transaction_id text unique;
```

A website route `POST /api/billing/app-store` validates the signed
transaction, then credits through the same function the web checkout uses.
An App Store Server Notifications endpoint handles refunds. Tests cover
replay (the same transaction twice credits once).

## Promote a listing

`featured_addon` exists as a pack. The PromoteListing board's targeting
(districts, days) needs `job_promotions(job_id, starts_at, ends_at,
district_ids)` and the board's ranking reading it. The ranking is a website
change and needs its own review.

## Subscriptions

The brief says monthly tiers are **a product decision, not yet approved**.
Nothing is proposed until they are.

## Decisions (2026-10-30)

1. No in-app purchases (decided earlier).
2. Subscriptions: **later**.
