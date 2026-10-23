import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { CompanyLogo } from '@/components/companies/company-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import { CommissionLine, SalaryLine } from '@/components/jobs/compensation';
import { bestOf } from '@/lib/saved/compare';
import { formatDate, formatNumber, formatRelativeDay } from '@/lib/format';
import type { JobListItem } from '@/lib/job-list';

/**
 * Two or three saved listings side by side, in the order they were chosen.
 * A cell that is better than the others — highest salary or commission, the
 * company bringing the clients, the most seats — is marked. Nothing is
 * marked where they are all the same. Columns keep a readable width and the
 * row scrolls sideways.
 */
export async function CompareTable({ jobs, locale }: { jobs: JobListItem[]; locale: string }) {
  const t = await getTranslations('compare');
  const tFilters = await getTranslations('filters');
  const tCompensation = await getTranslations('compensation');
  const tLeads = await getTranslations('leadsSource');
  const tTrack = await getTranslations('track');
  const tJob = await getTranslations('jobForm');
  const tExperience = await getTranslations('experienceBand');
  const tJobs = await getTranslations('jobs');
  const tCompanies = await getTranslations('companies');
  const best = bestOf(jobs);

  const rows: {
    key: string;
    label: string;
    cell: (job: JobListItem) => ReactNode;
    best?: ReadonlySet<string>;
  }[] = [
    {
      key: 'district',
      label: tFilters('district'),
      cell: (job) => localized(locale, job.district.name_ar, job.district.name_en),
    },
    {
      key: 'salary',
      label: t('salary'),
      cell: (job) => <SalaryLine job={job} locale={locale} />,
      best: best.salary,
    },
    {
      key: 'commission',
      label: tCompensation('commission'),
      cell: (job) => <CommissionLine job={job} locale={locale} />,
      best: best.commission,
    },
    {
      key: 'leads',
      label: tCompensation('leadsSource'),
      cell: (job) => tLeads(job.leads_source),
      best: best.leads,
    },
    {
      key: 'track',
      label: tFilters('track'),
      cell: (job) => tTrack(job.track),
    },
    {
      key: 'experience',
      label: tJob('experienceBand'),
      cell: (job) => tExperience(job.experience_band),
    },
    {
      key: 'seats',
      label: tJob('seats'),
      cell: (job) => (
        <span>
          <span className="numeral">{formatNumber(job.seats, locale)}</span> {tJobs('seatsLabel', { count: job.seats })}
        </span>
      ),
      best: best.seats,
    },
    {
      key: 'fresh',
      label: tFilters('posted'),
      cell: (job) => (
        <span>
          <span className="block">{job.published_at ? formatRelativeDay(job.published_at, locale) : '—'}</span>
          {job.expires_at ? (
            <span className="mt-0.5 block text-muted-foreground">{tJobs('expiresOn', { date: formatDate(job.expires_at, locale) })}</span>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('lede')}</p>
      <p className="text-sm text-muted-foreground">{t('scrollHint')}</p>
      <div className="overflow-x-auto">
        <div className="min-w-full space-y-5">
          <div className="flex gap-2">
            {jobs.map((job) => {
              const company = localized(locale, job.company.name_ar, job.company.name_en);
              const title = localized(locale, job.title_ar, job.title_en);
              return (
                <div key={job.id} className="min-w-[8.5rem] flex-1 space-y-2">
                  <CompanyLogo name={company} logoUrl={job.company.logo_url} seed={job.company.slug} size="sm" />
                  <p className="text-sm font-semibold leading-snug">{title}</p>
                  <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <bdi>{company}</bdi>
                    <VerifiedBadge compact status={job.company.verification_status} label={tCompanies('verified')} />
                  </p>
                </div>
              );
            })}
          </div>

          {rows.map((row) => (
            <div key={row.key} className="space-y-2">
              <h2 className="text-xs font-semibold text-muted-foreground">{row.label}</h2>
              <div className="flex gap-2">
                {jobs.map((job) => {
                  const marked = row.best?.has(job.id) ?? false;
                  return (
                    <div
                      key={job.id}
                      className={`min-w-[8.5rem] flex-1 rounded-xl border border-border p-3 text-sm ${marked ? 'bg-success-muted' : 'bg-card'}`}
                    >
                      {marked ? <p className="mb-1 text-xs font-semibold text-success">{t('best')}</p> : null}
                      {row.cell(job)}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            {jobs.map((job) => (
              <div key={job.id} className="min-w-[8.5rem] flex-1">
                <Link href={`/jobs/${job.slug}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                  {t('openJob')}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
