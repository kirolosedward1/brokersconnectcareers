import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Inbox, Search, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApplicantCard, type ApplicantProfile } from '@/components/employer/applicant-card';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatNumber } from '@/lib/utils';
import { getDistricts } from '@/lib/queries/taxonomy';
import { optional } from '@/lib/queries/error';
import { EXPERIENCE_BANDS, JOB_TRACKS } from '@/lib/taxonomy';
import type { ApplicationStatus, ExperienceBand, JobTrack } from '@/lib/supabase/database.types';

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
  job: { id: string; title_ar: string; title_en: string | null; track: JobTrack } | null;
};

/**
 * The id an employer with no company is scoped to.
 *
 * `requireEmployer` admits somebody whose company row does not exist yet, and
 * an undefined filter is not a narrow query — it is no query at all. A uuid
 * nothing carries asks for nothing, which is the right answer for an account
 * that has no listings to have applicants on.
 */
const NO_COMPANY = '00000000-0000-0000-0000-000000000000';

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
  searchParams: Promise<{ stage?: string; job?: string; q?: string; band?: string; track?: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const { stage, job: jobFilter, q: rawQuery, band: rawBand, track: rawTrack } = await searchParams;

  /*
    Two more ways to narrow, both real columns rather than derived guesses.

    The experience band is the applicant's own answer at apply time, on the
    application row itself. The specialisation is the listing's track — the
    thing a brokerage hiring for three primary-sales roles and one rentals
    role wants to slice by, and which the per-listing chips only offer one
    listing at a time. The applicant's *own* tracks live on their profile and
    are shown on the card; filtering by those would need an inner join that
    drops applicants without a profile, which is the wrong trade.

    Narrowed against the enums like ?stage= is, so an unknown value is ignored
    rather than sent to the database.
  */
  const band = EXPERIENCE_BANDS.find((value) => value === rawBand);
  const track = JOB_TRACKS.find((value) => value === rawTrack);

  /*
    A name to look for.

    Trimmed, capped, and with the two LIKE wildcards escaped — `%` and `_` are
    operators in `ilike`, so a search for "50%" would otherwise match every
    applicant on the platform rather than nobody, which is a confusing way to
    find out you typed a wildcard.
  */
  const query_ = (rawQuery ?? '').trim().slice(0, 80);
  const pattern = query_ ? `%${query_.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const supabase = await createClient();

  /*
    Scoped to this company, with row-level security still behind it.

    This deliberately carried no company filter, on the grounds that RLS
    already limits applications to listings this employer owns and a second
    filter would be a second copy of the rule. The reasoning is sound and the
    cost is not: without a filter the planner has nothing to index on, so it
    scans every application on the platform and evaluates `owns_job()` — a
    SECURITY DEFINER function — on each one. Measured on production against
    22,432 applications, the same shape of query took two seconds; with the
    scope it takes two and a half milliseconds.

    They are not two copies of one rule. RLS decides what may be seen; this
    decides what to look at. And the drift only runs one way: a wrong filter
    shows fewer rows, never more, because the policy is still what decides.

    What is left, measured rather than guessed, so the next person to wonder
    does not have to: with 7,010 applications on this one company the query is
    310 ms, and the cost is `owns_job()` being called once per row by the
    applications select policy. Two things were tried and neither is here.

    An index on (job_id, created_at desc) takes it to 231 ms without changing
    the plan's shape — the nested loop still materialises every row before the
    sort picks fifty. Twenty-five per cent of a cost that does not exist yet,
    for an index overlapping the (job_id, status) one already present, which is
    the index bloat migration 30 argues against.

    Rewriting the policy so the planner can hoist the predicate would be the
    real fix and is not worth it now: it is a change to the authorization model
    this round spent eighteen prompts making trustworthy, bought against a
    number that only appears at two hundred times today's data. Revisit it with
    traffic, not with instinct.
  */
  let query = supabase
    .from('applications')
    .select(
      `
      id, status, created_at, note, decision_note, cv_path, experience_band,
      candidate:profiles!inner (
        full_name,
        whatsapp_phone,
        avatar_url,
        agent_profiles (
          slug, headline_ar, headline_en, years_experience,
          tracks, district_ids, units_closed, volume_egp
        )
      ),
      job:jobs!inner (id, title_ar, title_en, track)
    `,
    )
    .eq('job.company_id', viewer.company?.id ?? NO_COMPANY)
    .order('created_at', { ascending: false })
    .limit(200);

  // Narrowed rather than asserted, so an unknown ?stage= in the URL is simply
  // ignored instead of reaching the query as an invalid enum value.
  const activeStage = STAGES.find((value) => value === stage);
  if (activeStage) query = query.eq('status', activeStage);
  if (jobFilter) query = query.eq('job_id', jobFilter);
  if (band) query = query.eq('experience_band', band);
  // On the joined listing — `jobs!inner` above is what makes this a filter
  // rather than a null-out of the embed.
  if (track) query = query.eq('job.track', track);
  // On the joined profile, which is why that embed is `!inner`. Filtered in
  // the database rather than over the 200 rows this page fetches — a search
  // that quietly only looks at the most recent page is worse than none.
  if (pattern) query = query.ilike('candidate.full_name', pattern);

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  // One column, no stage filter: what each chip is worth before it is clicked.
  // The list above is already narrowed by ?stage=, so it cannot answer this —
  // and "who applied" is a question about the whole pipeline, not the slice
  // currently on screen. Scoped to this company the same way the list above
  // is, with RLS behind it; the job filter is honoured so the counts match
  // what a click gives.
  // The profile is joined whether or not there is a search: a conditional
  // select string defeats the typed query builder, and every application has a
  // profile behind it — the column is `not null` — so the inner join changes
  // no count.
  let counter = supabase
    .from('applications')
    .select('status, candidate:profiles!inner (full_name), job:jobs!inner (track)')
    .limit(2000);
  counter = counter.eq('job.company_id', viewer.company?.id ?? NO_COMPANY);
  if (jobFilter) counter = counter.eq('job_id', jobFilter);
  if (band) counter = counter.eq('experience_band', band);
  if (track) counter = counter.eq('job.track', track);
  // The counts are what each chip is worth *within the current search*. Left
  // unfiltered they would promise applicants that clicking cannot produce.
  if (pattern) counter = counter.ilike('candidate.full_name', pattern);
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
  const tExp = await getTranslations('experienceBand');
  const tTrack = await getTranslations('track');

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

  const href = (next: { stage?: string; job?: string; q?: string; band?: string; track?: string }) => {
    const search = new URLSearchParams();
    if (next.stage) search.set('stage', next.stage);
    if (next.job) search.set('job', next.job);
    // Carried by every chip, so narrowing by stage does not silently throw the
    // search away — and the form below carries the chips the same way.
    if (next.q) search.set('q', next.q);
    if (next.band) search.set('band', next.band);
    if (next.track) search.set('track', next.track);
    const query = search.toString();
    return query ? `/employer/applicants?${query}` : '/employer/applicants';
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('allApplicants')}</h1>
        <p className="mt-1 text-muted-foreground">{t('allApplicantsLede')}</p>
        {/*
          The other half of what the applicant was told before they pressed
          send. They were promised this list is the only place their number
          goes; saying so here is what makes that promise something an employer
          has read too, rather than a claim made behind their back.
        */}
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('applicantsPrivacy')}
        </p>
      </header>

      {/*
        A plain GET form with no `action`, which submits to this same path and
        replaces the query string — so it needs the active chips back as hidden
        fields or searching would silently drop them. No JavaScript involved:
        this is the one shape of form that works before the page hydrates, and
        the field is named `q` because that is what the page reads.
      */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        {activeStage ? <input type="hidden" name="stage" value={activeStage} /> : null}
        {jobFilter ? <input type="hidden" name="job" value={jobFilter} /> : null}

        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
          />
          <label htmlFor="applicant-search" className="sr-only">
            {t('searchApplicants')}
          </label>
          <input
            id="applicant-search"
            name="q"
            type="search"
            defaultValue={query_}
            maxLength={80}
            placeholder={t('searchApplicantsPlaceholder')}
            className="h-11 w-full rounded-xl border border-input bg-card ps-9 pe-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground hover:border-border focus-visible:border-ring focus-visible:outline-none"
          />
        </div>

        {/* Native selects, submitted with the same button as the search. No
            JavaScript, same as the search field: this form has to work before
            the page hydrates, and a select that only applies on submit is
            honest about that. */}
        <label className="sr-only" htmlFor="applicant-band">
          {t('filterExperience')}
        </label>
        <select
          id="applicant-band"
          name="band"
          defaultValue={band ?? ''}
          className="h-11 rounded-xl border border-input bg-card px-3 text-sm shadow-xs"
        >
          <option value="">{t('filterExperience')}: {tFilters('any')}</option>
          {EXPERIENCE_BANDS.map((value) => (
            <option key={value} value={value}>
              {tExp(value)}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="applicant-track">
          {t('filterTrack')}
        </label>
        <select
          id="applicant-track"
          name="track"
          defaultValue={track ?? ''}
          className="h-11 rounded-xl border border-input bg-card px-3 text-sm shadow-xs"
        >
          <option value="">{t('filterTrack')}: {tFilters('any')}</option>
          {JOB_TRACKS.map((value) => (
            <option key={value} value={value}>
              {tTrack(value)}
            </option>
          ))}
        </select>

        <Button type="submit" variant="secondary">
          {t('filterApply')}
        </Button>

        {query_ || band || track ? (
          <Button asChild variant="ghost">
            <Link href={href({ stage, job: jobFilter })}>{t('filterClear')}</Link>
          </Button>
        ) : null}
      </form>

      <nav className={row} aria-label={t('stageFilter')}>
        <Link
          href={href({ job: jobFilter, q: query_, band, track })}
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
              href={href({ stage: value, job: jobFilter, q: query_, band, track })}
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
            href={href({ stage, q: query_, band, track })}
            aria-current={!jobFilter ? 'page' : undefined}
            className={chip(!jobFilter)}
          >
            {t('allListings')}
          </Link>
          {jobs.map((item) => (
            <Link
              key={item.id}
              href={href({ stage, job: item.id, q: query_, band, track })}
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
          {/* "Nobody has applied" and "nobody by that name" are different
              facts, and an employer who reads the first when the second is
              true concludes their listings are dead. */}
          {query_ ? t('searchEmpty') : band || track ? t('filterEmpty') : t('noApplicants')}
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
