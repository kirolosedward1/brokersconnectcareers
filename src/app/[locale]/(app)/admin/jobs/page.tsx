import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ModerateJobActions } from '@/components/admin/moderate-job-actions';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatEgp } from '@/lib/utils';
import type { JobRow } from '@/lib/supabase/database.types';

type QueueRow = JobRow & {
  company: { name_ar: string; name_en: string | null; slug: string; verification_status: string };
  district: { name_ar: string; name_en: string };
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('jobsQueue'), robots: { index: false, follow: false } };
}

export default async function AdminJobsPage({
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
  const filter = status === 'active' ? 'active' : 'pending_review';

  const supabase = await createClient();
  const { data } = await supabase
    .from('jobs')
    .select(
      `
      *,
      company:companies!inner (name_ar, name_en, slug, verification_status),
      district:districts!inner (name_ar, name_en)
    `,
    )
    .eq('status', filter)
    .order('created_at', { ascending: true });

  const jobs = (data ?? []) as unknown as QueueRow[];

  const t = await getTranslations('admin');
  const tJobs = await getTranslations('jobs');
  const tTrack = await getTranslations('track');
  const tLeads = await getTranslations('leadsSource');
  const tCompanies = await getTranslations('companies');
  const tCompensation = await getTranslations('compensation');
  const tCommission = await getTranslations('commissionType');
  const tCommon = await getTranslations('common');

  /** Whole days a listing has been sitting in the queue. */
  const waitingDays = (since: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('jobsQueue')}</h1>
        <p className="mt-1 text-muted-foreground">{t('jobsQueueLede')}</p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={t('jobsQueue')}>
        <Link
          href={{ pathname: '/admin/jobs', query: {} }}
          aria-current={filter === 'pending_review' ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm ${filter === 'pending_review' ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}
        >
          {t('jobsQueue')}
        </Link>
        <Link
          href={{ pathname: '/admin/jobs', query: { status: 'active' } }}
          aria-current={filter === 'active' ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm ${filter === 'active' ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}
        >
          {tJobs('title')}
        </Link>
      </nav>

      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          {t('emptyQueue')}
        </p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold">
                    {localized(locale, job.title_ar, job.title_en)}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Link href={`/companies/${job.company.slug}`} className="hover:underline">
                      {localized(locale, job.company.name_ar, job.company.name_en)}
                    </Link>
                    {job.company.verification_status === 'verified' ? (
                      <Badge variant="success">{tCompanies('verified')}</Badge>
                    ) : null}
                    <span>·</span>
                    <span>{localized(locale, job.district.name_ar, job.district.name_en)}</span>
                    <span>· {formatDate(job.created_at, locale)}</span>

                    {/* How long this has been waiting. admin_summary counts
                        the queue over 24 hours because a backlog that is not
                        moving is the thing worth knowing, and until now the
                        queue itself made a reviewer work it out from a date. */}
                    {filter === 'pending_review' ? (
                      <Badge variant={waitingDays(job.created_at) >= 1 ? 'destructive' : 'default'}>
                        <Clock aria-hidden />
                        {t('waiting', { days: waitingDays(job.created_at) })}
                      </Badge>
                    ) : null}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{tTrack(job.track)}</Badge>
                  <Badge variant="primary">{tLeads(`${job.leads_source}_short`)}</Badge>
                  <Badge variant="accent" className="numeral">
                    {job.seats}
                  </Badge>
                </div>
              </div>

              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {/* An open-ended range is stated as open-ended. `?? 0` printed
                    "0 – 15,000" for a role with no floor, which is a number
                    the employer never entered and a reviewer might act on. */}
                <div>
                  <dt className="sr-only">{tCompensation('basicSalary')}</dt>
                  {/* Only the digits are isolated, never the phrase.
                      The first version of this line put the whole string in
                      `.numeral`, which forces left-to-right — the same bug
                      fixed on the job card earlier today, rewritten from
                      scratch here within the hour. An Arabic reader met the
                      currency word first and the range high to low. */}
                  <dd>
                    {job.basic_salary_min != null && job.basic_salary_max != null ? (
                      <>
                        <span className="numeral">{formatEgp(job.basic_salary_min, locale)}</span>
                        {' – '}
                        <span className="numeral">{formatEgp(job.basic_salary_max, locale)}</span>{' '}
                        {tCommon('egp')}
                      </>
                    ) : job.basic_salary_min != null ? (
                      <>
                        <span className="numeral">{formatEgp(job.basic_salary_min, locale)}+</span>{' '}
                        {tCommon('egp')}
                      </>
                    ) : job.basic_salary_max != null ? (
                      <>
                        {'≤ '}
                        <span className="numeral">{formatEgp(job.basic_salary_max, locale)}</span>{' '}
                        {tCommon('egp')}
                      </>
                    ) : (
                      tCompensation('noBasicSalary')
                    )}
                  </dd>
                </div>

                {/* This printed the raw column for anything but a percentage,
                    so a reviewer read "split" and "none" in English on an
                    otherwise Arabic screen. Seven of eighteen demo listings. */}
                <div>
                  <dt className="sr-only">{tCompensation('commission')}</dt>
                  <dd>
                    {job.commission_type === 'percentage' && job.commission_value != null ? (
                      tCompensation.rich('commissionPercent', {
                        value: String(job.commission_value),
                        v: (chunks) => <span className="numeral">{chunks}</span>,
                      })
                    ) : (
                      tCommission(job.commission_type)
                    )}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                {job.description_ar}
              </p>

              <div className="mt-4">
                <ModerateJobActions
                  jobId={job.id}
                  isFeatured={job.is_featured}
                  showFeature={filter === 'active'}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
