import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { StatStrip } from '@/components/dashboard/stat-tile';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { formatNumber } from '@/lib/utils';
import type {
  AbuseLimitRow,
  AuditLogRow,
  SecurityEventRow,
  SecuritySummary,
} from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('security'), robots: { index: false, follow: false } };
}

/**
 * What the platform noticed in the last day, and who decided what.
 *
 * Numbers first — refusals, reveals, failed sign-ins — because a number that
 * has moved is the reason to read further. Under them, the two logs: the
 * events the platform recorded on its own, and the audit trail of decisions
 * people made. Subjects in the event log are hashes; there is nothing on this
 * page that identifies a visitor, and the actor column names an account id
 * rather than a person.
 *
 * The thresholds at the bottom are the ones the database enforces, read from
 * abuse_limits. Shown rather than edited: the numbers are a decision, and a
 * decision is made with a SQL statement and a note, not a slider.
 */
export default async function AdminSecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  await requireAdmin(locale);
  const supabase = await createClient();

  const [{ data: summaryData, error: summaryError }, events, audit, limits] = await Promise.all([
    supabase.rpc('security_summary'),
    supabase.from('security_events').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('abuse_limits').select('*').order('key'),
  ]);

  if (summaryError) raise(summaryError, 'loading the security summary');
  // The three lists are allowed to fail quietly: the summary above is the
  // page, and a list that could not be read renders as empty under a heading.
  const summary = (summaryData ?? null) as SecuritySummary | null;
  const eventRows = (events.data ?? []) as SecurityEventRow[];
  const auditRows = (audit.data ?? []) as AuditLogRow[];
  const limitRows = (limits.data ?? []) as AbuseLimitRow[];

  const t = await getTranslations('admin');
  const n = (value: number) => formatNumber(value, locale);
  const when = (value: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Cairo',
    }).format(new Date(value));

  if (!summary) return null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-bold">{t('security')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('securityLede')}</p>
      </header>

      <div className="space-y-2">
        <StatStrip
          label={t('securityNoticed')}
          cells={[
            {
              label: t('secEvents'),
              value: n(summary.events_total),
              href: '/admin/security',
              tone: summary.events_critical > 0 ? 'urgent' : summary.events_warning > 0 ? 'warn' : 'default',
            },
            {
              label: t('secRateLimited'),
              value: n(summary.rate_limited_24h),
              href: '/admin/security',
              tone: summary.rate_limited_24h > 0 ? 'warn' : 'default',
            },
            {
              label: t('secAuthFailures'),
              value: n(summary.auth_failures_24h),
              href: '/admin/security',
              tone: summary.auth_failures_24h > 20 ? 'warn' : 'default',
            },
            {
              label: t('secUploadsRejected'),
              value: n(summary.uploads_rejected_24h),
              href: '/admin/security',
              tone: summary.uploads_rejected_24h > 0 ? 'accent' : 'default',
            },
          ]}
        />
        <StatStrip
          label={t('securityHanded')}
          cells={[
            { label: t('secReveals'), value: n(summary.reveals_24h), href: '/admin/security' },
            {
              label: t('secSuspended'),
              value: n(summary.accounts_suspended),
              href: '/admin/users?status=rejected',
            },
            { label: t('secReportsOpen'), value: n(summary.reports_open), href: '/admin/reports' },
            { label: t('secJobsPending'), value: n(summary.jobs_pending), href: '/admin/jobs' },
            { label: t('secSignups'), value: n(summary.signups_24h), href: '/admin/users' },
          ]}
        />
      </div>

      <section aria-labelledby="sec-events">
        <h2 id="sec-events" className="text-sm font-semibold">
          {t('secEventsTitle')}
        </h2>
        {eventRows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('emptyQueue')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('secWhen')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('secKind')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('secSeverity')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('secSubject')}</th>
                </tr>
              </thead>
              <tbody>
                {eventRows.map((event) => (
                  <tr key={event.id} className="border-t border-border">
                    <td className="numeral whitespace-nowrap px-3 py-2">{when(event.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {event.kind}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          event.severity === 'critical'
                            ? 'destructive'
                            : event.severity === 'warning'
                              ? 'warning'
                              : 'outline'
                        }
                      >
                        {event.severity}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {event.actor_id ? event.actor_id.slice(0, 8) : event.subject_hash ? event.subject_hash.slice(0, 16) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="sec-audit">
        <h2 id="sec-audit" className="text-sm font-semibold">
          {t('secAuditTitle')}
        </h2>
        {auditRows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('emptyQueue')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('secWhen')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('secActor')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('secAction')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('secTarget')}</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="numeral whitespace-nowrap px-3 py-2">{when(entry.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {entry.actor_role}
                      {entry.actor_id ? ` · ${entry.actor_id.slice(0, 8)}` : ''}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {entry.action}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {entry.target_type}
                      {entry.target_id ? ` · ${entry.target_id.slice(0, 8)}` : ''}
                      {typeof entry.metadata?.from === 'string' && typeof entry.metadata?.to === 'string'
                        ? ` · ${entry.metadata.from} → ${entry.metadata.to}`
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="sec-limits">
        <h2 id="sec-limits" className="text-sm font-semibold">
          {t('secLimitsTitle')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('secLimitsHint')}</p>
        <div className="mt-2 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('secLimitKey')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('secLimitWindow')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('secLimitMax')}</th>
              </tr>
            </thead>
            <tbody>
              {limitRows.map((limit) => (
                <tr key={limit.key} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {limit.key}
                  </td>
                  <td className="numeral px-3 py-2">{n(Math.round(limit.window_seconds / 60))}</td>
                  <td className="numeral px-3 py-2">{n(limit.max_hits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
