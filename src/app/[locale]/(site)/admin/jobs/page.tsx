import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
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

export default async function AdminJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
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

  return (
    <div>
      <nav className="mb-6 flex gap-2">
        <Link
          href={{ pathname: '/admin/jobs', query: {} }}
          className={`rounded-md px-3 py-1.5 text-sm ${filter === 'pending_review' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        >
          {t('jobsQueue')}
        </Link>
        <Link
          href={{ pathname: '/admin/jobs', query: { status: 'active' } }}
          className={`rounded-md px-3 py-1.5 text-sm ${filter === 'active' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
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
                    <span className="numeral">· {formatDate(job.created_at, locale)}</span>
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
                <div className="numeral">
                  {job.basic_salary_min != null || job.basic_salary_max != null
                    ? `${formatEgp(job.basic_salary_min ?? 0, locale)} – ${formatEgp(job.basic_salary_max ?? 0, locale)}`
                    : '—'}
                </div>
                <div className="numeral">
                  {job.commission_type === 'percentage' ? `${job.commission_value}%` : job.commission_type}
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
