import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  Check,
  EyeOff,
  MessageCircle,
  Search,
  Target,
  Users,
  Zap,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import {
  CandidateIllustration,
  EmployerIllustration,
  VisibilityIllustration,
} from '@/components/home/illustrations';
import { buildLandingSlug, JOB_TRACKS } from '@/lib/taxonomy';
import type { DistrictRow } from '@/lib/supabase/database.types';

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
}: {
  locale: Locale;
  districts: DistrictRow[];
}) {
  const t = await getTranslations('landingPage');
  const tTrack = await getTranslations('track');

  return (
    <>
      <Hero locale={locale} />
      <Features />
      <HowItWorks />
      <AgentPrivacy />
      <Browse locale={locale} districts={districts} />
      <EmployerBand />
    </>
  );

  // ---------------------------------------------------------------------------

  async function Hero({ locale }: { locale: Locale }) {
    // A plain GET form, so search works before any JavaScript loads.
    const action = locale === 'ar' ? '/jobs' : '/en/jobs';

    return (
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(58rem_30rem_at_72%_-12%,var(--brand-blue),transparent_68%),radial-gradient(38rem_22rem_at_15%_10%,var(--brand-cyan),transparent_70%)] opacity-[0.13]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.3] [mask-image:radial-gradient(45rem_22rem_at_60%_0%,black,transparent)] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:3rem_3rem]"
        />

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div className="text-center lg:text-start">
              <Badge variant="primary" size="lg" className="rise-in mb-6">
                {t('hero.eyebrow')}
              </Badge>

              <h1 className="rise-in [--rise-delay:70ms] text-3xl font-bold leading-[1.25] text-balance sm:text-5xl sm:leading-[1.18]">
                {t('hero.title')}
              </h1>

              <p className="rise-in [--rise-delay:140ms] mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground lg:mx-0">
                {t('hero.subtitle')}
              </p>

              <form
                action={action}
                className="rise-in [--rise-delay:210ms] mx-auto mt-8 flex max-w-xl flex-col gap-2 sm:flex-row lg:mx-0"
              >
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    type="search"
                    name="q"
                    placeholder={t('hero.searchPlaceholder')}
                    aria-label={t('hero.searchLabel')}
                    className="h-12 w-full rounded-lg border border-input bg-card ps-10 pe-4 text-base shadow-sm placeholder:text-muted-foreground"
                  />
                </div>
                <Button type="submit" size="lg" className="h-12 shrink-0 px-7">
                  {t('hero.cta')}
                </Button>
              </form>

              <div className="rise-in [--rise-delay:280ms] mt-6 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                <span className="text-sm text-muted-foreground">{t('hero.popular')}</span>
                {JOB_TRACKS.slice(0, 4).map((track) => (
                  <Link key={track} href={{ pathname: '/jobs', query: { track } }}>
                    <Badge variant="outline" size="lg" className="bg-card hover:bg-muted">
                      {tTrack(track)}
                    </Badge>
                  </Link>
                ))}
              </div>

              <p className="rise-in [--rise-delay:350ms] mt-7 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Check className="size-4 text-success" aria-hidden />
                {t('hero.trustNoSpam')}
              </p>
            </div>

            {/* Decorative: the copy beside it already says everything this
                conveys, so it carries no alt text. */}
            <div className="rise-in [--rise-delay:240ms] relative lg:-me-12 lg:w-[calc(100%+3rem)]">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-8 rounded-[3rem] bg-[radial-gradient(closest-side,var(--brand-cyan),transparent)] opacity-25 blur-2xl"
              />
              <Image
                src="/brand/hero-job-search.png"
                alt=""
                width={2000}
                height={1143}
                priority
                sizes="(max-width: 1024px) 90vw, 45vw"
                className="relative mx-auto h-auto w-full max-w-xl lg:max-w-none"
              />
            </div>
          </div>
        </div>
      </section>
    );
  }

  async function Features() {
    const items = [
      { icon: Banknote, title: 'features.payTitle', body: 'features.payBody', accent: true },
      { icon: Target, title: 'features.leadsTitle', body: 'features.leadsBody', accent: true },
      { icon: Users, title: 'features.seatsTitle', body: 'features.seatsBody', accent: false },
      { icon: CalendarClock, title: 'features.freshTitle', body: 'features.freshBody', accent: false },
      { icon: Zap, title: 'features.applyTitle', body: 'features.applyBody', accent: false },
      { icon: MessageCircle, title: 'features.whatsappTitle', body: 'features.whatsappBody', accent: false },
    ] as const;

    return (
      <section className="mx-auto max-w-6xl px-4 py-20" aria-labelledby="features-heading">
        <div className="reveal mx-auto max-w-2xl text-center">
          <h2 id="features-heading" className="text-2xl font-bold text-balance sm:text-3xl">
            {t('features.title')}
          </h2>
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
            {t('features.subtitle')}
          </p>
        </div>

        <ul className="reveal mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, title, body, accent }) => (
            <li
              key={title}
              className={
                accent
                  ? 'lift rounded-2xl border border-primary/25 bg-primary/[0.04] p-6 shadow-sm'
                  : 'lift rounded-2xl border border-border bg-card p-6 shadow-sm'
              }
            >
              <span
                aria-hidden
                className={
                  accent
                    ? 'bg-brand-gradient grid size-11 place-items-center rounded-xl text-primary-foreground shadow-[var(--shadow-primary)]'
                    : 'grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground'
                }
              >
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{t(title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(body)}</p>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  async function HowItWorks() {
    const columns = [
      {
        id: 'candidates',
        heading: 'how.candidates',
        illustration: <CandidateIllustration className="h-auto w-full max-w-md" />,
        steps: [
          ['how.candidate1Title', 'how.candidate1Body'],
          ['how.candidate2Title', 'how.candidate2Body'],
          ['how.candidate3Title', 'how.candidate3Body'],
        ],
      },
      {
        id: 'employers',
        heading: 'how.employers',
        illustration: <EmployerIllustration className="h-auto w-full max-w-md" />,
        steps: [
          ['how.employer1Title', 'how.employer1Body'],
          ['how.employer2Title', 'how.employer2Body'],
          ['how.employer3Title', 'how.employer3Body'],
        ],
      },
    ] as const;

    return (
      <section className="border-y border-border bg-muted/40" aria-labelledby="how-heading">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 id="how-heading" className="reveal mb-10 text-center text-2xl font-bold sm:text-3xl">
            {t('how.title')}
          </h2>

          {/* Two audiences, one section. Tabs rather than columns so neither
              side reads as a footnote to the other. */}
          <Tabs
            tabs={columns.map((column) => ({ id: column.id, label: t(column.heading) }))}
            panels={columns.map((column) => (
              <div
                key={column.id}
                className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr]"
              >
                <ol className="space-y-7">
                  {column.steps.map(([title, body], index) => (
                    <li key={title} className="flex gap-4">
                      <span
                        aria-hidden
                        className="bg-brand-gradient numeral grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-primary-foreground shadow-[var(--shadow-primary)]"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold">{t(title)}</p>
                        <p className="mt-1.5 leading-relaxed text-muted-foreground">{t(body)}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="order-first flex justify-center lg:order-last">
                  {column.illustration}
                </div>
              </div>
            ))}
          />
        </div>
      </section>
    );
  }

  async function AgentPrivacy() {
    return (
      <section className="mx-auto max-w-6xl px-4 py-20" aria-labelledby="agents-band-heading">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span
              aria-hidden
              className="bg-brand-gradient grid size-11 place-items-center rounded-xl text-primary-foreground shadow-[var(--shadow-primary)]"
            >
              <EyeOff className="size-5" />
            </span>
            <h2 id="agents-band-heading" className="mt-5 text-2xl font-bold text-balance sm:text-3xl">
              {t('agentsBand.title')}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              {t('agentsBand.body')}
            </p>

            <ul className="mt-6 space-y-3">
              {(['agentsBand.point1', 'agentsBand.point2', 'agentsBand.point3'] as const).map(
                (point) => (
                  <li key={point} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <span className="text-sm leading-relaxed">{t(point)}</span>
                  </li>
                ),
              )}
            </ul>

            <Button asChild size="lg" className="mt-8">
              <Link href="/sign-up">
                {t('agentsBand.cta')}
                <ArrowRight className="rtl-flip" />
              </Link>
            </Button>
          </div>

          <div className="flex justify-center">
            <VisibilityIllustration className="h-auto w-full max-w-md" />
          </div>
        </div>
      </section>
    );
  }

  async function Browse({ locale, districts }: { locale: Locale; districts: DistrictRow[] }) {
    if (districts.length === 0) return null;

    return (
      <section className="border-y border-border bg-muted/40" aria-labelledby="browse-heading">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 id="browse-heading" className="reveal text-center text-lg font-semibold">
            {t('browse.title')}
          </h2>

          <div className="reveal mt-8 grid gap-10 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">{t('browse.byTrack')}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {JOB_TRACKS.map((track) => (
                  <li key={track}>
                    <Link href={{ pathname: '/jobs', query: { track } }}>
                      <Badge variant="outline" size="lg" className="bg-card shadow-xs transition-colors hover:border-primary/40 hover:bg-background">
                        {tTrack(track)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-medium text-muted-foreground">
                {t('browse.byDistrict')}
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {/* Deep links into the programmatic landing pages, so the
                    crawlable page is the one that gets the internal link. */}
                {districts.slice(0, 12).map((district) => (
                  <li key={district.id}>
                    <Link href={`/jobs/${buildLandingSlug('primary', district.slug)}`}>
                      <Badge variant="outline" size="lg" className="bg-card shadow-xs transition-colors hover:border-primary/40 hover:bg-background">
                        {localized(locale, district.name_ar, district.name_en)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    );
  }

  async function EmployerBand() {
    return (
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="bg-brand-gradient reveal relative overflow-hidden rounded-[1.75rem] px-6 py-16 text-center text-primary-foreground shadow-lg">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:2.5rem_2.5rem] [mask-image:radial-gradient(30rem_16rem_at_50%_0%,black,transparent)]"
          />
          <h2 className="relative text-2xl font-bold text-balance sm:text-3xl">
            {t('employerBand.title')}
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-lg leading-relaxed opacity-90">
            {t('employerBand.body')}
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="secondary">
              <Link href="/employer/jobs/new">{t('employerBand.cta')}</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="text-primary-foreground hover:bg-white/10"
            >
              <Link href="/companies">{t('employerBand.secondary')}</Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }
}
