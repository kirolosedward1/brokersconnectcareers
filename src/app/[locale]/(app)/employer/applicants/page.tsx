import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Inbox } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ApplicantCard, type ApplicantProfile } from '@/components/employer/applicant-card';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatNumber } from '@/lib/utils';
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
    avatar_url: string | null;
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
        avatar_url,
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

  // One column, no stage filter: what each chip is worth before it is clicked.
  // The list above is already narrowed by ?stage=, so it cannot answer this —
  // and "who applied" is a question about the whole pipeline, not the slice
  // currently on screen. RLS scopes it to this company's listings, same as the
  // list; the job filter is honoured so the counts match what a click gives.
  let counter = supabase.from('applications').select('status').limit(2000);
  if (jobFilter) counter = counter.eq('job_id', jobFilter);
  const { data: statuses } = await counter;

  const stageCount = new Map<string, number>();
  for (const item of (statuses ?? []) as { status: string }[]) {
    stageCount.set(item.status, (stageCount.get(item.status) ?? 0) + 1);
  }
  const totalCount = (statuses ?? []).length;

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

  /**
   * One row that scrolls sideways on a phone, wrapping only when there is room.
   *
   * Wrapping was the first version and it was wrong: six stages and one chip
   * per listing wrapped to five rows, which ate more than half of a 375px
   * screen before a single applicant appeared — on the screen whose entire
   * purpose is seeing who applied without hunting.
   */
  const row = 'flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible';

  const chip = (active: boolean) =>
    (active
      ? 'bg-primary text-primary-foreground font-medium'
      : 'border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground') +
    ' shrink-0 rounded-full px-3.5 py-1.5 text-sm';

  /**
   * A hue per stage, matching what the badge on each card already means:
   * blue is untouched, violet is picked out, amber is in progress, green is
   * hired, red is closed. The chips and the badges disagreeing about what
   * "shortlisted" looks like would be worse than either choice alone.
   *
   * One lightness across the set, chosen so white text clears 4.5:1 — the chip
   * paints its own ground, so this holds in both themes without a dark variant
   * and without a token that only exists inside a media query.
   */
  const STAGE_COLOUR: Record<(typeof STAGES)[number], string> = {
    new: 'oklch(0.55 0.16 266)',
    shortlisted: 'oklch(0.55 0.16 300)',
    interview: 'oklch(0.52 0.13 70)',
    hired: 'oklch(0.50 0.13 155)',
    rejected: 'oklch(0.55 0.17 27)',
  };

  const stageChip = (active: boolean) =>
    'shrink-0 rounded-full ps-3 pe-2.5 py-1.5 text-sm inline-flex items-center gap-2 transition-colors ' +
    (active ? 'font-medium text-white' : 'border border-border hover:bg-muted');

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

      <nav className={row} aria-label={t('stageFilter')}>
        <Link
          href={href({ job: jobFilter })}
          aria-current={!stage ? 'page' : undefined}
          className={stageChip(!stage) + (stage ? ' text-muted-foreground' : '')}
          style={!stage ? { backgroundColor: 'oklch(0.45 0.02 265)' } : undefined}
        >
          {tFilters('any')}
          <span className="numeral rounded-full bg-black/15 px-1.5 text-xs font-semibold tabular-nums">
            {formatNumber(totalCount, locale)}
          </span>
        </Link>

        {STAGES.map((value) => {
          const active = stage === value;
          const count = stageCount.get(value) ?? 0;
          return (
            <Link
              key={value}
              href={href({ stage: value, job: jobFilter })}
              aria-current={active ? 'page' : undefined}
              className={stageChip(active) + (active ? '' : ' text-muted-foreground')}
              style={active ? { backgroundColor: STAGE_COLOUR[value] } : undefined}
            >
              {/* The colour, carried on an inactive chip too — otherwise the
                  stage only has an identity once you are already in it. */}
              {active ? null : (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: STAGE_COLOUR[value] }}
                />
              )}
              {tStatus(value)}
              <span
                className={
                  'numeral rounded-full px-1.5 text-xs font-semibold tabular-nums ' +
                  (active ? 'bg-black/15' : 'bg-muted text-foreground')
                }
              >
                {formatNumber(count, locale)}
              </span>
            </Link>
          );
        })}
      </nav>

      {jobs.length > 1 ? (
        <nav className={row} aria-label={t('jobs')}>
          <Link
            href={href({ stage })}
            aria-current={!jobFilter ? 'page' : undefined}
            className={chip(!jobFilter)}
          >
            {t('allListings')}
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
                headingLevel={2}
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
