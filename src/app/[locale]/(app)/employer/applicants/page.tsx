import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Inbox } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ApplicantCard, type ApplicantProfile } from '@/components/employer/applicant-card';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDistricts } from '@/lib/queries/taxonomy';
import { optional } from '@/lib/queries/error';
import type { ApplicationStatus, ExperienceBand } from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'employer' });
  return { title: t('allApplicants'), robots: { index: false, follow: false } };
}

type Row = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  note: string | null;
  decision_note: string | null;
  cv_path: string | null;
  experience_band: ExperienceBand | null;
  candidate: {
    full_name: string;
    whatsapp_phone: string;
    agent_profiles: ApplicantProfile | null;
  } | null;
  job: { id: string; title_ar: string; title_en: string | null } | null;
};

const STAGES = ['new', 'shortlisted', 'interview', 'hired', 'rejected'] as const;

/**
 * Every applicant across every listing, newest first.
 *
 * The per-listing view answers "who applied to this role". This answers the
 * question an employer actually opens the site with, which is "who applied" —
 * and until now that cost one page visit per live listing, every morning.
 *
 * Newest first rather than grouped by stage, which is the opposite of the
 * per-listing page and deliberate: there, the stages are a pipeline you work
 * through; here, recency is the whole point, because the reason to open this
 * page is that something arrived.
 *
 * Filters are links, so a view is a URL somebody can bookmark or send on.
 */
export default async function AllApplicantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ stage?: string; job?: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const { stage, job: jobFilter } = await searchParams;
  const supabase = await createClient();

  // No company filter here on purpose. Row-level security already limits
  // applications to listings this employer owns, so a filter written here
  // would be a second copy of that rule, drifting from the first.
  let query = supabase
    .from('applications')
    .select(
      `
      id, status, created_at, note, decision_note, cv_path, experience_band,
      candidate:profiles (
        full_name,
        whatsapp_phone,
        agent_profiles (
          slug, headline_ar, headline_en, years_experience,
          tracks, district_ids, units_closed, volume_egp
        )
      ),
      job:jobs!inner (id, title_ar, title_en)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(200);

  // Narrowed rather than asserted, so an unknown ?stage= in the URL is simply
  // ignored instead of reaching the query as an invalid enum value.
  const activeStage = STAGES.find((value) => value === stage);
  if (activeStage) query = query.eq('status', activeStage);
  if (jobFilter) query = query.eq('job_id', jobFilter);

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const districts = await optional(getDistricts(), []);
  const districtName = new Map(
    districts.map((d) => [d.id, localized(locale, d.name_ar, d.name_en)]),
  );
  const namesFor = (ids: number[] | undefined) =>
    (ids ?? []).map((id) => districtName.get(id)).filter((name): name is string => Boolean(name));

  // The listings worth offering as a filter are the ones that have applicants,
  // which the rows already name — no second query for a dropdown.
  const jobs = [...new Map(rows.map((row) => [row.job?.id, row.job])).values()].filter(
    (item): item is NonNullable<Row['job']> => Boolean(item),
  );

  const t = await getTranslations('employer');
  const tStatus = await getTranslations('applicationStatus');
  const tFilters = await getTranslations('filters');

  const companyName = viewer.company
    ? localized(locale, viewer.company.name_ar, viewer.company.name_en)
    : '';

  const chip = (active: boolean) =>
    active
      ? 'rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground'
      : 'rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

  const href = (next: { stage?: string; job?: string }) => {
    const search = new URLSearchParams();
    if (next.stage) search.set('stage', next.stage);
    if (next.job) search.set('job', next.job);
    const query = search.toString();
    return query ? `/employer/applicants?${query}` : '/employer/applicants';
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('allApplicants')}</h1>
        <p className="mt-1 text-muted-foreground">{t('allApplicantsLede')}</p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={t('allApplicants')}>
        <Link href={href({ job: jobFilter })} aria-current={!stage ? 'page' : undefined} className={chip(!stage)}>
          {tFilters('any')}
        </Link>
        {STAGES.map((value) => (
          <Link
            key={value}
            href={href({ stage: value, job: jobFilter })}
            aria-current={stage === value ? 'page' : undefined}
            className={chip(stage === value)}
          >
            {tStatus(value)}
          </Link>
        ))}
      </nav>

      {jobs.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label={t('jobs')}>
          <Link
            href={href({ stage })}
            aria-current={!jobFilter ? 'page' : undefined}
            className={chip(!jobFilter)}
          >
            {t('jobs')}
          </Link>
          {jobs.map((item) => (
            <Link
              key={item.id}
              href={href({ stage, job: item.id })}
              aria-current={jobFilter === item.id ? 'page' : undefined}
              className={chip(jobFilter === item.id)}
            >
              {localized(locale, item.title_ar, item.title_en)}
            </Link>
          ))}
        </nav>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
          {t('noApplicants')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              {/* Which listing this was for. On the per-listing page that is
                  the heading; here it is the one thing a row cannot omit. */}
              {row.job ? (
                <Link
                  href={`/employer/jobs/${row.job.id}/applicants`}
                  className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  <Inbox className="size-3.5" aria-hidden />
                  {localized(locale, row.job.title_ar, row.job.title_en)}
                </Link>
              ) : null}

              <ApplicantCard
                application={row}
                jobTitle={row.job ? localized(locale, row.job.title_ar, row.job.title_en) : ''}
                companyName={companyName}
                locale={locale}
                districtNames={namesFor(row.candidate?.agent_profiles?.district_ids)}
              />
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        <p className="numeral text-center text-sm text-muted-foreground">
          <Badge>{rows.length}</Badge>
        </p>
      ) : null}
    </div>
  );
}
