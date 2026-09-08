import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BriefcaseBusiness, Eye, MapPin, Pencil, Plus, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JobStatusActions } from '@/components/employer/job-status-actions';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatNumber, isoDate } from '@/lib/utils';
import type { JobRow, JobStatus } from '@/lib/supabase/database.types';

const STATUS_VARIANT: Record<JobStatus, 'default' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  draft: 'default',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'employer' });
  return { title: t('jobs'), robots: { index: false, follow: false } };
}

export default async function EmployerJobsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const t = await getTranslations('employer');
  const tStatus = await getTranslations('jobStatus');
  const tJobs = await getTranslations('jobs');

  if (!viewer.company) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="font-medium">{t('createCompanyFirst')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('createCompanyFirstBody')}</p>
        <Button asChild className="mt-5">
          <Link href="/employer/company">{t('company')}</Link>
        </Button>
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from('jobs')
    .select(
      `
      *,
      district:districts (name_ar, name_en),
      applications (count)
    `,
    )
    .eq('company_id', viewer.company.id)
    .order('created_at', { ascending: false });

  const jobs = (data ?? []) as unknown as (JobRow & {
    district: { name_ar: string; name_en: string } | null;
    applications: { count: number }[];
  })[];

  return (
    <div className="space-y-6">
      {/* Stacked on a phone rather than wrapped: justify-between put the
          button alone on the second line and shoved it to the far edge, which
          reads as a mistake. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('jobs')}</h1>
          <p className="mt-1 text-muted-foreground">{t('jobsLede')}</p>
        </div>
        <Button asChild className="self-start">
          <Link href="/employer/jobs/new">
            <Plus />
            {t('newJob')}
          </Link>
        </Button>
      </header>

      <p className="text-sm text-muted-foreground">
        {tJobs('resultsCount', { count: jobs.length })}
      </p>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="font-medium">{t('noJobs')}</p>
          <Button asChild className="mt-5">
            <Link href="/employer/jobs/new">{t('newJob')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => {
            const applicants = job.applications?.[0]?.count ?? 0;
            return (
              <li key={job.id} className="rounded-xl border border-border bg-card p-5">
                <div>
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-semibold">
                      {job.status === 'active' ? (
                        <Link href={`/jobs/${job.slug}`} className="hover:underline">
                          {localized(locale, job.title_ar, job.title_en)}
                        </Link>
                      ) : (
                        localized(locale, job.title_ar, job.title_en)
                      )}
                      <Badge variant={STATUS_VARIANT[job.status]}>{tStatus(job.status)}</Badge>
                    </h2>

                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      {job.district ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" aria-hidden />
                          {localized(locale, job.district.name_ar, job.district.name_en)}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <BriefcaseBusiness className="size-3.5" aria-hidden />
                        <span className="numeral">{formatNumber(job.seats, locale)}</span>
                        {tJobs('seatsLabel', { count: job.seats })}
                      </span>
                      {job.status === 'active' ? (
                        <span className="numeral inline-flex items-center gap-1">
                          <Eye className="size-3.5" aria-hidden />
                          {formatNumber(job.view_count, locale)}
                        </span>
                      ) : null}
                      {/* No `.numeral` on the expiry. It forces left-to-right,
                          and this is a sentence rather than a figure — "تنتهي
                          في 13 سبتمبر" came out with the date before the words.
                          A date inside RTL prose orders itself correctly. */}
                      {job.expires_at && job.status === 'active' ? (
                        <time dateTime={isoDate(job.expires_at)}>
                          {tJobs('expiresOn', { date: formatDate(job.expires_at, locale) })}
                        </time>
                      ) : null}
                    </p>

                    {job.rejection_note ? (
                      <p className="mt-2 rounded-md bg-destructive-muted p-2 text-xs text-destructive">
                        {job.rejection_note}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline">
                    <Link href={`/employer/jobs/${job.id}/applicants`}>
                      <Users aria-hidden />
                      <span>
                        {t.rich('pipelineCount', {
                          count: applicants,
                          v: (chunks) => <span className="numeral">{chunks}</span>,
                        })}
                      </span>
                    </Link>
                  </Button>
                  <Button asChild variant="ghost">
                    <Link href={`/employer/jobs/${job.id}/edit`}>
                      <Pencil aria-hidden />
                      {t('editJob')}
                    </Link>
                  </Button>
                  <JobStatusActions
                    jobId={job.id}
                    status={job.status}
                    labels={{
                      close: t('closeJob'),
                      reopen: t('reopenJob'),
                      submit: t('submitForReview'),
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
