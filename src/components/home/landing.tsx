import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  Check,
  EyeOff,
  MapPin,
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
import { VisibilityIllustration } from '@/components/home/illustrations';
import { HeroShell } from '@/components/home/hero-shell';
import { TimelineSteps } from '@/components/home/timeline-steps';
import { ApplyStep, FilterStep, TrackStep } from '@/components/home/candidate-steps';
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
  const tFilters = await getTranslations('filters');

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
    const action = locale === 'ar' ? '/jobs' : `/${locale}/jobs`;

    return (
      <HeroShell>

        <h1 className="rise-in mt-2 text-4xl font-bold leading-[1.15] text-balance text-white sm:text-6xl">
          {t('hero.title')}
        </h1>

        <p className="rise-in [--rise-delay:210ms] mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/75">
          {t('hero.subtitle')}
        </p>

        {/* The centrepiece. One row on desktop — what, where, go — and a stack
            on a phone, where a three-column search bar becomes three
            unreadable slivers. */}
        <form
          action={action}
          className="rise-in [--rise-delay:280ms] mt-10 w-full max-w-3xl rounded-2xl border border-white/15 bg-white/10 p-2 shadow-2xl backdrop-blur-md sm:rounded-full"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                name="q"
                placeholder={t('hero.searchPlaceholder')}
                aria-label={t('hero.searchLabel')}
                className="h-13 w-full rounded-xl border-0 bg-white px-4 ps-11 text-base text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary sm:rounded-full"
              />
            </div>

            <div className="relative sm:w-52">
              <MapPin
                className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-muted-foreground"
                aria-hidden
              />
              <select
                name="district"
                aria-label={t('browse.byDistrict')}
                defaultValue=""
                className="h-13 w-full appearance-none rounded-xl border-0 bg-white px-4 ps-11 text-base text-slate-900 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary sm:rounded-full"
              >
                <option value="">{tFilters('any')}</option>
                {districts.slice(0, 12).map((district) => (
                  <option key={district.id} value={district.slug}>
                    {localized(locale, district.name_ar, district.name_en)}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" size="lg" className="h-13 shrink-0 rounded-xl px-8 sm:rounded-full">
              {t('hero.cta')}
            </Button>
          </div>
        </form>

        <div className="rise-in [--rise-delay:350ms] mt-7 flex flex-wrap items-center justify-center gap-2">
          <span className="text-sm text-white/60">{t('hero.popular')}</span>
          {JOB_TRACKS.slice(0, 4).map((track) => (
            <Link key={track} href={{ pathname: '/jobs', query: { track } }}>
              <span className="inline-flex rounded-full border border-white/20 bg-white/5 px-3.5 py-1.5 text-sm text-white/90 transition-colors hover:border-white/40 hover:bg-white/15">
                {tTrack(track)}
              </span>
            </Link>
          ))}
        </div>

        <p className="rise-in [--rise-delay:420ms] mt-8 inline-flex items-center gap-1.5 text-sm text-white/60">
          <Check className="size-4 text-emerald-400" aria-hidden />
          {t('hero.trustNoSpam')}
        </p>
      </HeroShell>
    );
  }

  async function Features() {
    // The two the whole product is built around lead; the rest support them.
    const items = [
      { icon: Banknote, kind: 'kindPay', title: 'payTitle', body: 'payBody', lead: true },
      { icon: Target, kind: 'kindLeads', title: 'leadsTitle', body: 'leadsBody', lead: true },
      { icon: Users, kind: 'kindSeats', title: 'seatsTitle', body: 'seatsBody', lead: false },
      { icon: CalendarClock, kind: 'kindFresh', title: 'freshTitle', body: 'freshBody', lead: false },
      { icon: Zap, kind: 'kindApply', title: 'applyTitle', body: 'applyBody', lead: false },
      {
        icon: MessageCircle,
        kind: 'kindWhatsapp',
        title: 'whatsappTitle',
        body: 'whatsappBody',
        lead: false,
      },
    ] as const;

    return (
      <section className="mx-auto max-w-6xl px-4 py-24" aria-labelledby="features-heading">
        <div className="reveal mx-auto max-w-2xl text-center">
          <h2 id="features-heading" className="text-3xl font-bold text-balance sm:text-4xl">
            {t('features.title')}
          </h2>
        </div>

        {/* Columns rather than cards, matching the employer side: an icon, a
            category word, a heading, the body. Two coloured tiles mark the
            arguments the other four support. */}
        <ul className="reveal mt-16 grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, kind, title, body, lead }) => (
            <li key={title}>
              <span
                aria-hidden
                className={
                  lead
                    ? 'bg-brand-gradient grid size-11 place-items-center rounded-xl text-primary-foreground shadow-[var(--shadow-primary)]'
                    : 'grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground'
                }
              >
                <Icon className="size-5" />
              </span>

              <p
                className={
                  lead
                    ? 'mt-5 text-sm font-medium text-primary'
                    : 'mt-5 text-sm font-medium text-muted-foreground'
                }
              >
                {t(`features.${kind}`)}
              </p>

              <h3 className="mt-1.5 text-lg font-semibold leading-snug text-balance">
                {t(`features.${title}`)}
              </h3>

              <p className="mt-3 leading-relaxed text-muted-foreground">{t(`features.${body}`)}</p>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  async function HowItWorks() {
    return (
      <section className="border-y border-border bg-background" aria-labelledby="how-heading">
        <div className="mx-auto max-w-5xl px-4 py-24">
          <h2
            id="how-heading"
            className="reveal mb-14 text-center text-3xl font-bold text-balance sm:text-4xl"
          >
            {t('how.title')}
          </h2>

          <TimelineSteps
            className="reveal"
            steps={[
              {
                key: 'candidate1',
                title: t('how.candidate1Title'),
                body: t('how.candidate1Body'),
                takeaway: t('how.candidate1Takeaway'),
                illustration: <FilterStep className="h-auto w-full" />,
              },
              {
                key: 'candidate2',
                title: t('how.candidate2Title'),
                body: t('how.candidate2Body'),
                takeaway: t('how.candidate2Takeaway'),
                illustration: <ApplyStep className="h-auto w-full" />,
              },
              {
                key: 'candidate3',
                title: t('how.candidate3Title'),
                body: t('how.candidate3Body'),
                takeaway: t('how.candidate3Takeaway'),
                illustration: <TrackStep className="h-auto w-full" />,
              },
            ]}
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
