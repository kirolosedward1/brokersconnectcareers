import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, Infinity as InfinityIcon } from 'lucide-react';
import { asLocale, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClaimFreePostButton } from '@/components/employer/claim-free-post';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { BILLING_ENABLED } from '@/lib/env';
import { POST_PACKS } from '@/lib/taxonomy';
import { formatDate, formatEgp, formatNumber } from '@/lib/utils';
import type { OrderRow } from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'billing' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function BillingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const t = await getTranslations('billing');

  let orders: OrderRow[] = [];
  let claimedThisMonth = false;

  if (viewer.company) {
    const supabase = await createClient();
    const period = new Date();
    period.setUTCDate(1);

    const [{ data: orderRows }, { data: grant }] = await Promise.all([
      supabase
        .from('orders')
        .select('*')
        .eq('company_id', viewer.company.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('monthly_free_post_grants')
        .select('period')
        .eq('company_id', viewer.company.id)
        .eq('period', period.toISOString().slice(0, 10))
        .maybeSingle(),
    ]);

    orders = (orderRows ?? []) as OrderRow[];
    claimedThisMonth = Boolean(grant);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('lede')}</p>
      </header>

      {/* Billing is built and reachable; it is simply priced at zero until the
          board has candidate volume. */}
      {BILLING_ENABLED ? null : (
        <div className="rounded-xl border border-success/30 bg-success-muted p-5">
          <p className="font-medium">{t('disabled')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('disabledBody')}</p>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium text-muted-foreground">{t('credits')}</h2>
        <p className="mt-1 text-3xl font-bold text-primary">
          <span className="numeral">{formatNumber(viewer.company?.post_credits ?? 0, locale)}</span>
        </p>

        {viewer.company?.verification_status === 'verified' ? (
          <div className="mt-4">
            <ClaimFreePostButton claimed={claimedThisMonth} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="packs-heading">
        <h2 id="packs-heading" className="mb-4 text-lg font-semibold">
          {t('packs')}
        </h2>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {POST_PACKS.map((pack) => (
            <li
              key={pack.key}
              className="flex flex-col rounded-xl border border-border bg-card p-5"
            >
              <p className="font-semibold">{t(`packName.${pack.key}`)}</p>

              <p className="mt-2 text-2xl font-bold">
                <span className="numeral">
                  {BILLING_ENABLED ? formatEgp(pack.priceEgp, locale) : formatEgp(0, locale)}
                </span>
                <span className="ms-1 text-sm font-normal text-muted-foreground">
                  {locale === 'ar' ? 'جنيه' : 'EGP'}
                </span>
              </p>

              {BILLING_ENABLED ? null : (
                <p className="mt-1 text-xs text-muted-foreground line-through">
                  <span className="numeral">{formatEgp(pack.priceEgp, locale)}</span>
                </p>
              )}

              <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  {pack.seats === null ? (
                    <InfinityIcon className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <Check className="size-3.5 shrink-0" aria-hidden />
                  )}
                  <span >
                    {pack.seats === null
                      ? t('unlimitedSeats')
                      : t('seatsUpTo', { count: formatNumber(pack.seats, locale) })}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0" aria-hidden />
                  {/* Same reason as the expiry line: a phrase, not a
                       figure. `.numeral` put "يوماً" before the number. */}
                  <span>{t('days', { count: formatNumber(pack.days, locale) })}</span>
                </li>
              </ul>

              <Button className="mt-5" disabled={!BILLING_ENABLED}>
                {t('buy')}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {orders.length ? (
        <section aria-labelledby="orders-heading">
          <h2 id="orders-heading" className="mb-4 text-lg font-semibold">
            {t('orders')}
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {orders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <span>{t(`packName.${order.pack_key}`)}</span>
                <span className="text-muted-foreground">
                  {formatDate(order.created_at, locale)}
                </span>
                <span className="numeral">{formatEgp(order.amount_egp, locale)}</span>
                {/* Was the raw column: an employer read "paid" and "failed"
                    in English on an otherwise Arabic invoice list. */}
                <Badge
                  variant={
                    order.status === 'paid'
                      ? 'success'
                      : order.status === 'failed'
                        ? 'destructive'
                        : 'default'
                  }
                >
                  {t(`orderStatus.${order.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
