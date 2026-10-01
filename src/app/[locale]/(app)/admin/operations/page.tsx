import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { RequeueEmailButton } from '@/components/admin/requeue-email-button';
import { isRetryable } from '@/lib/email/rebuild';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { formatNumber } from '@/lib/utils';
import type {
  EmailDeadLetterRow,
  JobRunRow,
  JobRunStatus,
  OutboxOverview,
  ScheduledJobOverviewRow,
} from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('operations'), robots: { index: false, follow: false } };
}

/**
 * Every job vercel.json schedules, named here so a job that has never run
 * still gets a row.
 *
 * The overview is built from job_runs, and a job that has never recorded a
 * run is simply absent from it — which on a table of what ran reads as
 * "nothing to see". A cron that was never wired up, or whose secret stopped
 * matching, is exactly that absence, and it is the most important thing this
 * page can show. So the expected set is the spine and the database fills it.
 */
const EXPECTED_JOBS = ['expire-jobs', 'email-retry', 'daily-digest', 'job-alerts', 'new-jobs'];

const VARIANT: Record<JobRunStatus, 'default' | 'primary' | 'success' | 'destructive' | 'outline'> = {
  running: 'primary',
  succeeded: 'success',
  failed: 'destructive',
  skipped: 'default',
};

/**
 * Date and time, in Cairo. Runs are minutes apart, so the day alone — which
 * is all formatDate gives — would make every row of the recent-runs table
 * read the same.
 */
function formatMoment(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Cairo',
  }).format(new Date(value));
}

/** Counts a run recorded, as one line of identifiers — `sent 3 · failed 1`. */
function statsLine(stats: Record<string, number | boolean> | null): string {
  if (!stats) return '';
  return Object.entries(stats)
    .filter(([key]) => key !== 'ms')
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(' · ');
}

/**
 * The background work, in one place.
 *
 * Everything here used to be invisible. A cron either ran or did not, and the
 * only record was a log line that scrolled away; an email that failed three
 * times sat as `failed` next to ones that would be retried in ten minutes,
 * with nothing to tell them apart. This page answers the three questions an
 * admin actually asks: are the scheduled jobs running, is mail stuck, and
 * which messages has the system stopped trying to send.
 *
 * Built from the email activity page's parts — same header, same table, same
 * badges — because this is the same console and should read like it.
 *
 * Reads raise rather than render empty. "No dead letters" and "no failed
 * runs" are the answers an admin acts on by going away, and a read that
 * failed must not produce them.
 */
export default async function AdminOperationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const supabase = await createClient();
  const [overviewRead, outboxRead, deadRead, runsRead] = await Promise.all([
    supabase.rpc('scheduled_job_overview'),
    supabase.rpc('outbox_overview'),
    supabase.rpc('email_dead_letters', { p_limit: 100 }),
    supabase.rpc('recent_job_runs', { p_limit: 50 }),
  ]);

  if (overviewRead.error) raise(overviewRead.error, 'loading the scheduled job overview');
  if (outboxRead.error) raise(outboxRead.error, 'loading the outbox overview');
  if (deadRead.error) raise(deadRead.error, 'loading the email dead letters');
  if (runsRead.error) raise(runsRead.error, 'loading recent job runs');

  const overview = (overviewRead.data ?? []) as ScheduledJobOverviewRow[];
  const outbox = ((outboxRead.data ?? []) as OutboxOverview[])[0] ?? null;
  const dead = (deadRead.data ?? []) as EmailDeadLetterRow[];
  const runs = (runsRead.data ?? []) as JobRunRow[];

  const byJob = new Map(overview.map((row) => [row.job, row]));
  // Expected jobs first, in schedule order; anything else the table knows
  // about (a job since renamed or retired) after them, so it is not hidden.
  const jobs = [
    ...EXPECTED_JOBS,
    ...overview.map((row) => row.job).filter((job) => !EXPECTED_JOBS.includes(job)),
  ].map((job) => ({ job, row: byJob.get(job) ?? null }));

  const t = await getTranslations('admin');

  const seconds = (ms: number | null) =>
    ms === null ? '—' : t('opsSeconds', { value: formatNumber(Math.round(ms / 100) / 10, locale) });

  const outboxFigures: { label: string; value: number }[] = outbox
    ? [
        { label: t('opsDue'), value: Number(outbox.due) },
        { label: t('opsInFlight'), value: Number(outbox.in_flight) },
        { label: t('opsWaiting'), value: Number(outbox.waiting) },
        { label: t('opsDead'), value: Number(outbox.dead) },
      ]
    : [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-bold">{t('operations')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('operationsLede')}</p>
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold">{t('opsJobsTitle')}</h2>
        {/* Scrolls in its own container, like every wide admin table. */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-border bg-muted/50 text-start">
              <tr>
                <th scope="col" className="p-3 text-start font-medium">{t('opsJob')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('emailStatusColumn')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('opsLastRun')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('opsDuration')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('opsLastSuccess')}</th>
                <th scope="col" className="p-3 text-start font-medium">{t('opsFailures')}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(({ job, row }) => (
                <tr key={job} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{job}</code>
                    {row?.running ? (
                      <span className="block pt-1 text-xs text-primary">{t('opsRunningNow')}</span>
                    ) : null}
                  </td>
                  <td className="p-3">
                    {row?.last_status ? (
                      <Badge variant={VARIANT[row.last_status]}>
                        {t(`opsStatus.${row.last_status}`)}
                      </Badge>
                    ) : (
                      <Badge variant="warning">{t('opsNeverRun')}</Badge>
                    )}
                    {row?.last_error ? (
                      <span
                        className="block max-w-[18rem] truncate pt-1 text-xs text-destructive"
                        title={row.last_error}
                      >
                        {row.last_error}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {row?.last_started_at ? formatMoment(row.last_started_at, locale) : '—'}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {seconds(row?.last_duration_ms ?? null)}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {row?.last_success_at ? formatMoment(row.last_success_at, locale) : '—'}
                  </td>
                  <td className="p-3">
                    <span
                      className={
                        'numeral text-xs ' +
                        (row && Number(row.failures_7d) > 0
                          ? 'font-semibold text-destructive'
                          : 'text-muted-foreground')
                      }
                    >
                      {formatNumber(Number(row?.failures_7d ?? 0), locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">{t('opsOutboxTitle')}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {outboxFigures.map((figure) => (
            <div key={figure.label} className="rounded-xl border border-border p-4">
              <dt className="text-xs text-muted-foreground">{figure.label}</dt>
              <dd className="numeral mt-1 text-xl font-semibold tabular-nums">
                {formatNumber(figure.value, locale)}
              </dd>
            </div>
          ))}
        </dl>
        {outbox?.oldest_due_at ? (
          <p className="text-sm text-muted-foreground">
            {t('opsOldestDue', { when: formatMoment(outbox.oldest_due_at, locale) })}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">{t('opsDeadTitle')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('opsDeadLede')}</p>
        </div>
        {dead.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-muted-foreground">
            {t('opsDeadEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-border bg-muted/50 text-start">
                <tr>
                  <th scope="col" className="p-3 text-start font-medium">{t('emailRecipient')}</th>
                  <th scope="col" className="p-3 text-start font-medium">{t('emailTemplate')}</th>
                  <th scope="col" className="p-3 text-start font-medium">{t('opsAttempts')}</th>
                  <th scope="col" className="p-3 text-start font-medium">{t('emailError')}</th>
                  <th scope="col" className="p-3 text-start font-medium">{t('opsGaveUpAt')}</th>
                  <th scope="col" className="p-3 text-start font-medium">
                    <span className="sr-only">{t('opsRetry')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dead.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <span className="numeral block max-w-[16rem] truncate" title={row.recipient}>
                        {row.recipient}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatMoment(row.created_at, locale)}
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
                      <span className="numeral text-xs text-muted-foreground">
                        ×{formatNumber(row.attempts, locale)}
                      </span>
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
                    <td className="p-3 text-xs text-muted-foreground">
                      {formatMoment(row.gave_up_at, locale)}
                    </td>
                    <td className="p-3">
                      {/* Only where a requeue can send something. A template
                          the sweeper cannot rebuild comes straight back as a
                          dead letter having sent nothing, so a button there
                          would report a success that never happens. */}
                      {isRetryable(row.template) && row.entity_id ? (
                        <RequeueEmailButton emailId={row.id} />
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
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">{t('opsRunsTitle')}</h2>
        {runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-muted-foreground">
            {t('opsRunsEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-border bg-muted/50 text-start">
                <tr>
                  <th scope="col" className="p-3 text-start font-medium">{t('opsJob')}</th>
                  <th scope="col" className="p-3 text-start font-medium">{t('emailStatusColumn')}</th>
                  <th scope="col" className="p-3 text-start font-medium">{t('opsStarted')}</th>
                  <th scope="col" className="p-3 text-start font-medium">{t('opsDuration')}</th>
                  <th scope="col" className="p-3 text-start font-medium">{t('opsStats')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{run.job}</code>
                    </td>
                    <td className="p-3">
                      <Badge variant={VARIANT[run.status]}>{t(`opsStatus.${run.status}`)}</Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {formatMoment(run.started_at, locale)}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {seconds(run.duration_ms)}
                    </td>
                    <td className="p-3">
                      {run.error ? (
                        <span
                          className="block max-w-[22rem] truncate text-xs text-destructive"
                          title={run.error}
                        >
                          {run.error}
                        </span>
                      ) : (
                        <span className="block max-w-[22rem] truncate font-mono text-xs text-muted-foreground">
                          {statsLine(run.stats) || '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
