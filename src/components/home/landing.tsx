import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  Check,
  EyeOff,
  MapPin,
  Search,
  Target,
  Users,
  Zap,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { VisibilityIllustration } from '@/components/home/illustrations';
import { HeroShell } from '@/components/home/hero-shell';
import { TimelineSteps } from '@/components/home/timeline-steps';
import { Illustration } from '@/components/illustration';
import type { DistrictRow } from '@/lib/supabase/database.types';
import { WhatsAppMark } from '@/components/brand-marks';
import { JobBrowse } from '@/components/home/job-browse';
import { JobCard } from '@/components/jobs/job-card';
import type { BrowseCounts } from '@/lib/queries/browse';
import type { JobListItem } from '@/lib/queries/jobs';

/**
 * The signed-out landing page.
 *
 * Every section here renders from static copy and the track taxonomy, which
 * lives in code — so the page still explains the product when the database is
 * unreachable. `districts` is the one piece that can arrive empty, and the
 * section that uses it simply does not render.
 */
export async function Landing({
  locale,
  districts,
  counts,
  jobs,
}: {
  locale: Locale;
  districts: DistrictRow[];
  /** Null when the read failed; the browse module then does not render. */
  counts: BrowseCounts | null;
  /** The newest live listings. Empty is fine — the section steps aside. */
  jobs: JobListItem[];
}) {
  const t = await getTranslations('landingPage');
  const tFilters = await getTranslations('filters');

  return (
    <>
      {/*
        The product before the pitch.

        This page used to open on a full-screen film, then six feature columns,
        then a three-step walkthrough, and reached anything a visitor could
        click on — a district, a track — four screens down. Somebody looking
        for work wants to know whether there is work, so the board comes
        first: ways in with live counts, then the newest listings themselves.
        The argument for why this board is different follows for the reader
        who still needs it, and it is shorter for having the evidence above it.
      */}
      <Hero locale={locale} />
      <JobBrowse locale={locale} counts={counts} districts={districts} />
      <LatestJobs />
      <Features />
      <HowItWorks />
      <AgentPrivacy />
      <EmployerBand />
    </>
  );

  // ---------------------------------------------------------------------------

  async function Hero({ locale }: { locale: Locale }) {
    // A plain GET form, so search works before any JavaScript loads.
    const action = locale === 'ar' ? '/jobs' : `/${locale}/jobs`;

    return (
      <HeroShell>

        <h1 className="text-3xl font-bold leading-[1.2] text-balance text-white sm:text-4xl lg:text-5xl">
          {t('hero.title')}
        </h1>

        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
          {t('hero.subtitle')}
        </p>

        {/* The centrepiece. One row on desktop — what, where, go — and a stack
            on a phone, where a three-column search bar becomes three
            unreadable slivers.

            A solid bar, not frosted glass. The blur cost a compositing layer
            over a playing video to make the form look like it belonged to a
            different product; white fields on the film read as the one thing
            on the hero you are meant to use. */}
        <form action={action} className="mt-7 w-full max-w-3xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0 sm:rounded-xl sm:bg-white sm:p-1.5">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-slate-400"
                aria-hidden
              />
              <input
                type="search"
                name="q"
                placeholder={t('hero.searchPlaceholder')}
                aria-label={t('hero.searchLabel')}
                className="h-12 w-full rounded-lg border-0 bg-white px-4 ps-11 text-base text-slate-900 outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <div className="relative sm:w-52 sm:border-s sm:border-slate-200">
              <MapPin
                className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-slate-400"
                aria-hidden
              />
              <select
                name="district"
                aria-label={t('browse.byDistrict')}
                defaultValue=""
                className="h-12 w-full appearance-none rounded-lg border-0 bg-white px-4 ps-11 text-base text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">{tFilters('any')}</option>
                {districts.slice(0, 12).map((district) => (
                  <option key={district.id} value={district.slug}>
                    {localized(locale, district.name_ar, district.name_en)}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" size="lg" className="shrink-0 px-7">
              {t('hero.cta')}
            </Button>
          </div>
        </form>

        {/* The row of "popular" track chips that sat here is gone: the browse
            module is the next thing on the page and offers the same tracks
            with a count beside each. */}
        <p className="mt-5 inline-flex items-center gap-1.5 text-sm text-white/65">
          <Check className="size-4 text-emerald-400" aria-hidden />
          {t('hero.trustNoSpam')}
        </p>
      </HeroShell>
    );
  }

  /**
   * The newest live listings, as the rows the board itself uses.
   *
   * Real ones or nothing. Six is two rows of three facts-lines each side on a
   * laptop — enough to show the board is alive and what a listing here looks
   * like, short of becoming the board.
   */
  async function LatestJobs() {
    if (jobs.length === 0) return null;
    const tJobs = await getTranslations('jobs');

    return (
      <section aria-labelledby="latest-heading" className="border-b border-border bg-muted/30">
        <div className="shell py-8 sm:py-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="latest-heading" className="text-lg font-bold sm:text-xl">
              {t('latest.title')}
            </h2>
            <Link
              href="/jobs"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              {tJobs('title')}
              <ArrowRight className="rtl-flip size-3.5" aria-hidden />
            </Link>
          </div>

          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {jobs.slice(0, 6).map((job) => (
              <li key={job.id}>
                <JobCard job={job} locale={locale} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  async function Features() {
    // The two the whole product is built around lead; the rest support them.
    const items = [
      { icon: Banknote, title: 'payTitle', body: 'payBody', lead: true },
      { icon: Target, title: 'leadsTitle', body: 'leadsBody', lead: true },
      { icon: Users, title: 'seatsTitle', body: 'seatsBody', lead: false },
      { icon: CalendarClock, title: 'freshTitle', body: 'freshBody', lead: false },
      { icon: Zap, title: 'applyTitle', body: 'applyBody', lead: false },
      // The feature is "they reach you on WhatsApp", so it carries the mark
      // people recognise rather than a generic speech bubble.
      { icon: WhatsAppMark, title: 'whatsappTitle', body: 'whatsappBody', lead: false },
    ] as const;

    return (
      <section className="shell py-12 sm:py-14" aria-labelledby="features-heading">
        <h2 id="features-heading" className="text-xl font-bold text-balance sm:text-2xl">
          {t('features.title')}
        </h2>

        {/* A ruled list, not tiles. Each of these was an icon in a coloured
            square, a category word, a heading and a paragraph, centred under a
            40px title with 96px above and below — the most recognisable layout
            on the internet, and a screen and a half of it. The six claims are
            worth keeping; they are set here as what they are, short statements
            a reader can run down, with the mark beside the heading it marks. */}
        <ul className="mt-5 grid gap-x-10 border-t border-border sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, title, body, lead }) => (
            <li key={title} className="border-b border-border py-5">
              <h3 className="flex items-center gap-2 font-semibold leading-snug">
                <Icon
                  className={lead ? 'size-4 shrink-0 text-primary' : 'size-4 shrink-0 text-muted-foreground'}
                  aria-hidden
                />
                {t(`features.${title}`)}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {t(`features.${body}`)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  async function HowItWorks() {
    return (
      <section className="border-y border-border bg-background" aria-labelledby="how-heading">
        <div className="shell py-12 sm:py-14">
          <h2 id="how-heading" className="mb-6 text-xl font-bold text-balance sm:text-2xl">
            {t('how.title')}
          </h2>

          <TimelineSteps
            
            steps={[
              {
                key: 'candidate1',
                title: t('how.candidate1Title'),
                body: t('how.candidate1Body'),
                takeaway: t('how.candidate1Takeaway'),
                illustration: <Illustration name="browse" />,
              },
              {
                key: 'candidate2',
                title: t('how.candidate2Title'),
                body: t('how.candidate2Body'),
                takeaway: t('how.candidate2Takeaway'),
                illustration: <Illustration name="apply" />,
              },
              {
                key: 'candidate3',
                title: t('how.candidate3Title'),
                body: t('how.candidate3Body'),
                takeaway: t('how.candidate3Takeaway'),
                illustration: <Illustration name="updates" />,
              },
            ]}
          />
        </div>
      </section>
    );
  }

  async function AgentPrivacy() {
    return (
      <section className="shell py-12 sm:py-14" aria-labelledby="agents-band-heading">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h2
              id="agents-band-heading"
              className="flex items-center gap-2.5 text-xl font-bold text-balance sm:text-2xl"
            >
              <EyeOff className="size-5 shrink-0 text-primary" aria-hidden />
              {t('agentsBand.title')}
            </h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              {t('agentsBand.body')}
            </p>

            <ul className="mt-5 space-y-2.5">
              {(['agentsBand.point1', 'agentsBand.point2', 'agentsBand.point3'] as const).map(
                (point) => (
                  <li key={point} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <span className="text-sm leading-relaxed">{t(point)}</span>
                  </li>
                ),
              )}
            </ul>

            <Button asChild className="mt-6">
              <Link href="/sign-up">
                {t('agentsBand.cta')}
                <ArrowRight className="rtl-flip" />
              </Link>
            </Button>
          </div>

          <div className="flex justify-center">
            <VisibilityIllustration className="h-auto w-full max-w-md" locale={locale} />
          </div>
        </div>
      </section>
    );
  }

  async function EmployerBand() {
    return (
      /* The other door, as a line and not a poster.

         This was a full-width gradient panel with a grid pattern masked into
         it, 24px corners and a centred headline — a second hero at the foot of
         a page whose audience is the people it was not talking to. A company
         that scrolled this far needs to see that the door exists and where it
         goes; it does not need to be sold to on the candidates' page, and the
         header has carried "post a job" the whole way down. */
      <section className="border-t border-border bg-muted/40">
        <div className="shell flex flex-col gap-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:gap-10">
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold text-balance">{t('employerBand.title')}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t('employerBand.body')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/*
              The employer door, not the generic one.

              This pointed straight at /employer/jobs/new, which is protected —
              and nobody reading this page is signed in, because the signed-in
              home is a different component entirely. So the middleware bounced
              every click to the generic sign-in, which opens on the job-seeker
              side: a company that came to post a job was asked to sign in as a
              consultant. `next` carries them to the wizard once they are
              through, so the click still ends where it was aimed.
            */}
            <Button asChild>
              <Link href={{ pathname: '/sign-in/employer', query: { next: '/employer/jobs/new' } }}>
                {t('employerBand.cta')}
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/companies">{t('employerBand.secondary')}</Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }
}
