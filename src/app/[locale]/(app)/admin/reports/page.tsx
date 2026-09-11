import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ReportActions } from '@/components/admin/report-actions';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { formatDate } from '@/lib/utils';
import type { JobStatus, ReportReason } from '@/lib/supabase/database.types';

type ReportRowWithJob = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  created_at: string;
  job_id: string;
  job: {
    slug: string;
    title_ar: string;
    title_en: string | null;
    status: JobStatus;
    company: { name_ar: string; name_en: string | null } | null;
  } | null;
};

/** Every open report on one listing, which is the unit a reviewer acts on. */
type ReportedJob = {
  jobId: string;
  job: ReportRowWithJob['job'];
  reports: ReportRowWithJob[];
  /** Oldest complaint in the group — what the queue is actually sorted on. */
  since: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('reports'), robots: { index: false, follow: false } };
}

export default async function AdminReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const supabase = await createClient();
  /*
    The error is read, not dropped.

    A moderation queue that renders empty when the read failed is the worst
    place in the product for this: the answer "nothing is waiting" is exactly
    what a reviewer acts on, and acting on it means going away. There is no
    honest partial version of a queue, so this raises to the console's error
    boundary, which offers Retry.
  */
  const { data, error } = await supabase
    .from('reports')
    .select(
      'id, reason, detail, created_at, job_id, job:jobs (slug, title_ar, title_en, status, company:companies (name_ar, name_en))',
    )
    .eq('resolved', false)
    .order('created_at', { ascending: true });

  if (error) raise(error, 'loading the reports queue');

  const rows = (data ?? []) as unknown as ReportRowWithJob[];

  /*
    Grouped by listing rather than listed flat.

    There is a unique index on (job_id, reporter_id), so two reports on the
    same advert are always two different people. Flat, that read as unrelated
    work and the reviewer closed the same complaint twice; grouped, the count
    is the queue's strongest signal — one complaint is somebody who did not get
    the job, six is a listing to look at today.
  */
  const grouped = new Map<string, ReportedJob>();
  for (const row of rows) {
    const existing = grouped.get(row.job_id);
    if (existing) {
      existing.reports.push(row);
    } else {
      grouped.set(row.job_id, {
        jobId: row.job_id,
        job: row.job,
        reports: [row],
        // Rows arrive oldest first, so the first one seen is the group's age.
        since: row.created_at,
      });
    }
  }

  // Most-reported first, and among equals the one that has waited longest.
  const queue = [...grouped.values()].sort(
    (a, b) => b.reports.length - a.reports.length || a.since.localeCompare(b.since),
  );

  const t = await getTranslations('admin');
  const tReason = await getTranslations('reportReason');
  const tStatus = await getTranslations('jobStatus');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('reports')}</h1>
        <p className="mt-1 text-muted-foreground">{t('reportsLede')}</p>
      </header>

      {queue.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          {t('emptyQueue')}
        </p>
      ) : (
        <ul className="space-y-3">
          {queue.map((group) => {
            const live = group.job?.status === 'active' || group.job?.status === 'pending_review';

            return (
              <li key={group.jobId} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t('reportedJob')}</p>
                    <h2 className="font-semibold">
                      {group.job ? (
                        <Link href={`/jobs/${group.job.slug}`} className="hover:underline">
                          {localized(locale, group.job.title_ar, group.job.title_en)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </h2>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      {group.job?.company ? (
                        <span>
                          {localized(locale, group.job.company.name_ar, group.job.company.name_en)}
                        </span>
                      ) : null}
                      <span>{formatDate(group.since, locale)}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* The count carries more than the reasons do, so it is the
                        loudest thing on the card. */}
                    <Badge variant={group.reports.length > 1 ? 'destructive' : 'outline'} size="lg">
                      {t('reportCount', { count: group.reports.length })}
                    </Badge>

                    {/* A listing already taken down still shows its open
                        reports, and the reviewer needs to know that before
                        they reach for the takedown button that is not there. */}
                    {!live && group.job ? (
                      <Badge variant="outline" size="lg">
                        {tStatus(group.job.status)}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <ul className="mt-4 space-y-2">
                  {group.reports.map((report) => (
                    <li
                      key={report.id}
                      className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{tReason(report.reason)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(report.created_at, locale)}
                        </span>
                      </div>
                      {report.detail ? (
                        <p className="mt-2 leading-relaxed text-muted-foreground">
                          {report.detail}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  <ReportActions jobId={group.jobId} jobIsLive={live} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
