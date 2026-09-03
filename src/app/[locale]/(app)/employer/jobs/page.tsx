import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Eye, MapPin, Plus, Users } from 'lucide-react';
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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="numeral text-sm text-muted-foreground">
          {tJobs('resultsCount', { count: jobs.length })}
        </p>
        <Button asChild>
          <Link href="/employer/jobs/new">
            <Plus />
            {t('newJob')}
          </Link>
        </Button>
      </div>

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
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold">
                      {job.status === 'active' ? (
                        <Link href={`/jobs/${job.slug}`} className="hover:underline">
                          {localized(locale, job.title_ar, job.title_en)}
                        </Link>
                      ) : (
                        localized(locale, job.title_ar, job.title_en)
                      )}
                    </h2>

                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      {job.district ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" aria-hidden />
                          {localized(locale, job.district.name_ar, job.district.name_en)}
                        </span>
                      ) : null}
                      <span className="numeral inline-flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden />
                        {formatNumber(job.seats, locale)}
                      </span>
                      {job.status === 'active' ? (
                        <span className="numeral inline-flex items-center gap-1">
                          <Eye className="size-3.5" aria-hidden />
                          {formatNumber(job.view_count, locale)}
                        </span>
                      ) : null}
                      {job.expires_at && job.status === 'active' ? (
                        <time dateTime={isoDate(job.expires_at)} className="numeral">
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

                  <Badge variant={STATUS_VARIANT[job.status]} size="lg">
                    {tStatus(job.status)}
                  </Badge>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/employer/jobs/${job.id}/applicants`}>
                      <Users />
                      <span className="numeral">{t('pipelineCount', { count: applicants })}</span>
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/employer/jobs/${job.id}/edit`}>{t('editJob')}</Link>
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
