import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatNumber } from '@/lib/utils';
import type { EmailActivityRow, EmailStatus } from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('emailActivity'), robots: { index: false, follow: false } };
}

const FILTERS: (EmailStatus | 'all')[] = [
  'all',
  'queued',
  'sent',
  'delivered',
  'bounced',
  'failed',
  'suppressed',
];

const VARIANT: Record<EmailStatus, 'default' | 'primary' | 'success' | 'destructive' | 'outline'> = {
  queued: 'outline',
  sent: 'primary',
  delivered: 'success',
  bounced: 'destructive',
  complained: 'destructive',
  failed: 'destructive',
  suppressed: 'default',
};

/**
 * What happened to the emails.
 *
 * Built for one question — "الإيميل موصلنيش" — which cannot be answered from
 * server logs after the fact. Recipient, template, what it was about, and the
 * two timestamps that mean different things: `sent` is when the provider
 * accepted it, `delivered` is when the receiving server did.
 *
 * No message body. The content is reconstructable from the template and the
 * entity, and keeping a copy of every status change ever mailed to a candidate
 * would be a second copy of the hiring pipeline, retained forever, readable by
 * anyone who reaches this page.
 */
export default async function AdminEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const { status } = await searchParams;
  const active = FILTERS.includes(status as EmailStatus) ? (status as EmailStatus) : null;

  const supabase = await createClient();
  const [{ data: rows }, { data: summary }] = await Promise.all([
    supabase.rpc('email_activity', { p_limit: 200, p_status: active }),
    supabase.rpc('email_activity_summary'),
  ]);

  const activity = (rows ?? []) as EmailActivityRow[];
  const counts = new Map(
    ((summary ?? []) as { status: EmailStatus; count: number }[]).map((row) => [
      row.status,
      Number(row.count),
    ]),
  );
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);

  const t = await getTranslations('admin');
  const tStatus = await getTranslations('emailStatus');

  const chip = (on: boolean) =>
    (on
      ? 'bg-primary text-primary-foreground font-medium'
      : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground') +
    ' inline-flex shrink-0 items-center gap-2 rounded-full ps-3 pe-2.5 py-1.5 text-sm transition-colors';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('emailActivity')}</h1>
        <p className="mt-1 text-muted-foreground">{t('emailActivityLede')}</p>
      </header>

      <nav
        aria-label={t('emailActivity')}
        className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible"
      >
        {FILTERS.map((value) => {
          const on = value === 'all' ? !active : active === value;
          const count = value === 'all' ? total : (counts.get(value) ?? 0);
          return (
            <Link
              key={value}
              href={value === 'all' ? '/admin/email' : { pathname: '/admin/email', query: { status: value } }}
              aria-current={on ? 'page' : undefined}
              className={chip(on)}
            >
              {value === 'all' ? t('emailAll') : tStatus(value)}
              <span
                className={
                  'numeral rounded-full px-1.5 text-xs font-semibold tabular-nums ' +
                  (on ? 'bg-black/15' : 'bg-muted text-foreground')
                }
              >
                {formatNumber(count, locale)}
              </span>
            </Link>
          );
        })}
      </nav>

      {activity.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          {t('emailEmpty')}
        </p>
      ) : (
        // Scrolls in its own container: seven columns do not fit a phone, and
        // the page body must never scroll sideways.
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-border bg-muted/50 text-start">
              <tr>
                <th scope="col" className="p-3 text-start font-medium">{t('emailRecipient')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('emailTemplate')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('emailStatusColumn')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('emailSentAt')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('emailDeliveredAt')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('emailError')}</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <span className="numeral block max-w-[16rem] truncate" title={row.recipient}>
                      {row.recipient}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(row.created_at, locale)}
                    </span>
                  </td>
                  <td className="p-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.template}</code>
                    {row.entity_type ? (
                      <span className="block pt-1 text-xs text-muted-foreground">
                        {row.entity_type}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <Badge variant={VARIANT[row.status]}>{tStatus(row.status)}</Badge>
                    {row.attempts > 1 ? (
                      <span className="numeral block pt-1 text-xs text-muted-foreground">
                        ×{formatNumber(Math.min(row.attempts, 3), locale)}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {row.sent_at ? formatDate(row.sent_at, locale) : '—'}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {row.delivered_at ? formatDate(row.delivered_at, locale) : '—'}
                  </td>
                  <td className="p-3">
                    {row.error ? (
                      <span
                        className="block max-w-[18rem] truncate text-xs text-destructive"
                        title={row.error}
                      >
                        {row.error}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Mail className="size-4 shrink-0" aria-hidden />
        {t('emailPreviewHint')}{' '}
        <a href="/api/email/preview" className="font-medium text-primary hover:underline">
          /api/email/preview
        </a>
      </p>
    </div>
  );
}
