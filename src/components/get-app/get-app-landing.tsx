import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BellRing,
  Building2,
  Check,
  Send,
  Target,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { env } from '@/lib/env';
import { JOB_TRACKS } from '@/lib/taxonomy';
import { Button } from '@/components/ui/button';
import { JsonLd } from '@/components/json-ld';
import { PhoneFrame } from '@/components/get-app/phone-frame';
import { HeroPhones } from '@/components/get-app/hero-phones';
import { SectionHeader } from '@/components/get-app/section-header';
import { StoreButtons, type StoreLabels } from '@/components/get-app/store-buttons';
import { Reveal } from '@/components/get-app/reveal';
import { Callouts } from '@/components/get-app/callouts';
import { FilterDemo } from '@/components/get-app/filter-demo';
import { ApplySteps } from '@/components/get-app/apply-steps';
import { NotificationStack } from '@/components/get-app/notification-stack';
import { FollowButtonDemo } from '@/components/get-app/follow-button-demo';
import { ProfileVisibilityDemo } from '@/components/get-app/profile-visibility-demo';
import { ScreenTour } from '@/components/get-app/screen-tour';
import { Faq } from '@/components/get-app/faq';
import { StickyDownloadBar } from '@/components/get-app/sticky-download-bar';

/**
 * The page that gets somebody to install the app. docs/app-page.md is the
 * plan it is built to: one ask, opened and closed with the store buttons,
 * and between them the app itself — the real captures from the iOS screens
 * workflow, one feature a section, a tour of the five screens, and the
 * three things a reader can try (the filters, the follow button, who sees
 * the profile) because trying beats reading.
 *
 * Every claim here is one the product makes about itself elsewhere — the
 * site's own copy, the store listing (mobile/store.config.js), the app's
 * own labels — and wherever the app already has words for something (a
 * notification, the follow button, the visibility choices, a lead source),
 * those words are used, not paraphrased. Nothing is counted, rated or
 * quoted. The page's own copy is the `appPage` namespace of messages/*.json;
 * the store links are lib/app-links.ts.
 *
 * Text is centred while the page is one column (below `lg`) and sits at the
 * start of its column from `lg`, where each section is two.
 */

const SHOT = '/app-screenshots';

/** The five screens, in the order the captures are taken. */
const SCREENS = ['home', 'jobs', 'listing', 'companies', 'company'] as const;
type ScreenKey = (typeof SCREENS)[number];
const shot = (key: ScreenKey) => `${SHOT}/${key}.webp`;

const HIGHLIGHTS = [
  { key: 'leads', icon: Target },
  { key: 'pay', icon: Banknote },
  { key: 'apply', icon: Send },
  { key: 'alerts', icon: BellRing },
] as const;

/** The eight areas the footer links to, by the keys the catalogue uses. */
const AREAS = ['tagamoa', 'zayed', 'october', 'capital', 'madinaty', 'maadi', 'heliopolis', 'nasr'] as const;
const LEADS = ['company_provided', 'self_generated', 'hybrid'] as const;
const VISIBILITY = ['public', 'verified_employers_only', 'hidden'] as const;
const VISIBILITY_HINT = { public: 'publicHint', verified_employers_only: 'verifiedHint', hidden: 'hiddenHint' } as const;

const FAQ = [1, 2, 3, 4, 5, 6] as const;

/** A dark section: the theme colour's family, with the brand's glow. */
const DARK =
  'relative isolate overflow-hidden bg-[linear-gradient(160deg,#0d1117_0%,#10192d_55%,#0e2b47_100%)] text-white [--ring:white]';

/** A section's vertical rhythm inside the content shell. */
const SECTION = 'shell py-16 sm:py-24 lg:py-32';

/** A phone with the brand's glow behind it, centred in its column. */
function GlowPhone({ src, alt, decorative = false }: { src: string; alt?: string; decorative?: boolean }) {
  return (
    <div className="relative mx-auto w-60 sm:w-[17rem]">
      <div
        aria-hidden
        className="absolute -inset-x-16 -inset-y-8 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-blue)_28%,transparent),transparent)]"
      />
      <PhoneFrame src={src} alt={alt} decorative={decorative} sizes="(min-width: 640px) 17rem, 15rem" />
    </div>
  );
}

export async function GetAppLanding() {
  const t = await getTranslations('appPage');
  const tMeta = await getTranslations('meta');
  const tTrack = await getTranslations('track');
  const tLeads = await getTranslations('leadsSource');
  const tJobs = await getTranslations('jobs');
  const tNotifications = await getTranslations('notifications');
  const tStatus = await getTranslations('applicationStatus');
  const tCompanies = await getTranslations('companies');
  const tVisibility = await getTranslations('visibility');

  const siteName = tMeta('siteName');
  const store: StoreLabels = {
    appStoreTop: t('store.appStoreTop'),
    appStoreLabel: t('store.appStoreLabel'),
    googlePlayTop: t('store.googlePlayTop'),
    googlePlayLabel: t('store.googlePlayLabel'),
    comingSoon: t('store.comingSoon'),
  };
  const screenAlt = (key: ScreenKey) => t('tour.alt', { screen: t(`tour.${key}`) });

  // The notifications, in the app's own words (lib/notifications/title.ts).
  const sampleJob = t('notifications.sampleJob');
  const notifications = [
    tNotifications('application_submitted', { subject: sampleJob }),
    tNotifications('applicationMoved', { title: sampleJob, status: tStatus('shortlisted') }),
    tNotifications('applicationMoved', { title: sampleJob, status: tStatus('interview') }),
    tNotifications('newJobsSearch', { count: 1, subject: t('notifications.sampleSearch') }),
  ];

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: siteName,
          operatingSystem: 'iOS',
          applicationCategory: 'BusinessApplication',
          inLanguage: 'ar',
          url: `${env.siteUrl}/app`,
          image: `${env.siteUrl}/brand/og-app.jpg`,
          description: t('meta.description'),
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'EGP' },
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ.map((n) => ({
            '@type': 'Question',
            name: t(`faq.q${n}`),
            acceptedAnswer: { '@type': 'Answer', text: t(`faq.a${n}`) },
          })),
        }}
      />

      {/* 1. Hero: what it is, that it is free, how to get it. */}
      <section id="get-app-hero" aria-labelledby="get-app-heading" className="relative isolate overflow-hidden">
        {/* Tinted in the middle and back to the page at both ends, so the
            hero has no edge where the next section starts. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,var(--background)_0%,color-mix(in_oklab,var(--primary)_7%,var(--background))_55%,var(--background)_100%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_70%)]"
        />

        <div className="shell grid items-center gap-10 pb-12 pt-10 sm:gap-12 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16 lg:py-24">
          <div className="mx-auto max-w-xl text-center lg:mx-0 lg:text-start">
            <span className="inline-flex items-center rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium shadow-xs">
              {t('hero.pill')}
            </span>
            <h1
              id="get-app-heading"
              className="mt-6 text-[clamp(2.5rem,2rem+2.5vw,4.5rem)] font-bold leading-tight text-balance"
            >
              {t('hero.title')}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground sm:text-xl">{t('hero.subtitle')}</p>
            <StoreButtons labels={store} location="hero" className="mt-8 justify-center lg:justify-start" />
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="size-4 text-success" aria-hidden />
              {t('hero.trust')}
            </p>
          </div>

          <HeroPhones front={shot('home')} left={shot('jobs')} right={shot('listing')} alt={screenAlt('home')} />
        </div>
      </section>

      <StickyDownloadBar
        heroId="get-app-hero"
        finalId="get-app-final"
        name={siteName}
        label={t('store.get')}
        ariaLabel={t('store.appStoreLabel')}
      />

      {/* 2. Four things, scannable. */}
      <section className="shell pb-16 pt-6 sm:pb-24 sm:pt-8">
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {HIGHLIGHTS.map(({ key, icon: Icon }, index) => (
            <Reveal key={key} as="li" delay={index * 80}>
              <div className="flex h-full flex-col items-center gap-2.5 rounded-[1.5rem] border border-border bg-card p-4 text-center shadow-sm transition-[transform,border-color] duration-200 sm:p-5 lg:items-start lg:text-start motion-safe:lg:hover:-translate-y-1 lg:hover:border-primary/40">
                <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <p className="font-bold leading-snug">{t(`highlights.${key}Title`)}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{t(`highlights.${key}Body`)}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* 3. The terms before applying: the reason the board exists. */}
      <section aria-labelledby="get-app-transparency" className={DARK}>
        <div
          aria-hidden
          className="absolute -top-1/3 start-[55%] -z-10 h-[50rem] w-[50rem] rounded-full bg-[radial-gradient(closest-side,rgba(42,79,246,0.4),transparent_72%)] will-change-transform motion-safe:animate-aurora"
        />
        <div className={`${SECTION} grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-16`}>
          <Reveal>
            <SectionHeader
              id="get-app-transparency"
              tone="dark"
              eyebrow={t('transparency.eyebrow')}
              title={t('transparency.title')}
              body={t('transparency.body')}
            />
            <div className="mx-auto mt-8 grid max-w-2xl gap-3 text-center sm:grid-cols-2 lg:mx-0 lg:text-start">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-white/60">{t('transparency.compareBadTitle')}</p>
                <p className="mt-1.5 text-white/55 line-through decoration-white/40">{t('transparency.compareBadBody')}</p>
              </div>
              <div className="rounded-2xl border border-brand-cyan/40 bg-white/10 p-4 ring-1 ring-brand-cyan/30">
                <p className="text-sm font-semibold text-brand-cyan">{t('transparency.compareGoodTitle')}</p>
                <p className="mt-1.5 font-semibold text-white">{t('transparency.compareGoodBody')}</p>
              </div>
            </div>
          </Reveal>

          <Callouts
            src={shot('listing')}
            alt={screenAlt('listing')}
            chips={[t('transparency.calloutSalary'), t('transparency.calloutCommission'), t('transparency.calloutLeads')]}
          />
        </div>
      </section>

      {/* 4. Finding the right job: the board, and its filters to try. */}
      <section aria-labelledby="get-app-search" className="overflow-hidden border-b border-border">
        <div className={`${SECTION} grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-16`}>
          <Reveal className="order-last lg:order-first">
            <GlowPhone src={shot('jobs')} alt={screenAlt('jobs')} />
          </Reveal>

          <div>
            <Reveal>
              <SectionHeader
                id="get-app-search"
                eyebrow={t('search.eyebrow')}
                title={t('search.title')}
                body={t('search.body')}
              />
            </Reveal>
            <Reveal delay={120}>
              <FilterDemo
                className="mt-8"
                label={t('search.demoLabel')}
                groups={[
                  {
                    key: 'track',
                    label: t('search.trackLabel'),
                    options: JOB_TRACKS.map((track) => ({ key: track, label: tTrack(track) })),
                    initial: ['primary'],
                  },
                  {
                    key: 'area',
                    label: t('search.areaLabel'),
                    options: AREAS.map((area) => ({ key: area, label: t(`search.area.${area}`) })),
                    initial: ['tagamoa'],
                  },
                  {
                    key: 'leads',
                    label: t('search.leadsLabel'),
                    options: LEADS.map((source) => ({ key: source, label: tLeads(source) })),
                  },
                  {
                    key: 'sort',
                    label: t('search.sortLabel'),
                    exclusive: true,
                    options: [
                      { key: 'newest', label: tJobs('sortNewest') },
                      { key: 'salary', label: tJobs('sortSalary') },
                    ],
                    initial: ['newest'],
                  },
                ]}
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* 5. Applying: three steps that light up. */}
      <section aria-labelledby="get-app-apply" className="overflow-hidden bg-muted/40">
        <div className={`${SECTION} grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16`}>
          <div>
            <Reveal>
              <SectionHeader
                id="get-app-apply"
                eyebrow={t('apply.eyebrow')}
                title={t('apply.title')}
                body={t('apply.body')}
              />
            </Reveal>
            <ApplySteps
              className="mx-auto mt-8 max-w-md lg:mx-0 lg:max-w-none"
              steps={[t('apply.step1'), t('apply.step2'), t('apply.step3')]}
            />
          </div>
          <Reveal className="order-last lg:order-first">
            <GlowPhone src={shot('listing')} decorative />
          </Reveal>
        </div>
      </section>

      {/* 6. Notifications, in the app's own words. */}
      <section aria-labelledby="get-app-notifications" className={DARK}>
        <div
          aria-hidden
          className="absolute -bottom-1/3 -start-[10%] -z-10 h-[46rem] w-[46rem] rounded-full bg-[radial-gradient(closest-side,rgba(92,225,230,0.22),transparent_72%)] will-change-transform motion-safe:animate-aurora-slow"
        />
        <div className={`${SECTION} grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-16`}>
          <Reveal>
            <SectionHeader
              id="get-app-notifications"
              tone="dark"
              eyebrow={t('notifications.eyebrow')}
              title={t('notifications.title')}
              body={t('notifications.body')}
            />
          </Reveal>
          <NotificationStack
            screen={`${SHOT}/dark/home.webp`}
            appName={siteName}
            now={t('notifications.now')}
            label={t('notifications.listLabel')}
            items={notifications}
          />
        </div>
      </section>

      {/* 7. The companies, and the one to follow. */}
      <section aria-labelledby="get-app-companies" className="overflow-hidden border-b border-border">
        <div className={`${SECTION} grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16`}>
          <div>
            <Reveal>
              <SectionHeader
                id="get-app-companies"
                eyebrow={t('companies.eyebrow')}
                title={t('companies.title')}
                body={t('companies.body')}
              />
            </Reveal>
            <Reveal delay={100}>
              <ul className="mx-auto mt-8 w-fit space-y-3 lg:mx-0">
                {[Building2, BadgeCheck, BellRing].map((Icon, index) => (
                  <li key={index} className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="font-medium">{t(`companies.point${index + 1}`)}</span>
                  </li>
                ))}
              </ul>
              <FollowButtonDemo
                className="mt-7"
                follow={tCompanies('follow')}
                following={tCompanies('following')}
                followHint={tCompanies('followHint')}
                followingHint={tCompanies('followingHint')}
              />
            </Reveal>
          </div>

          <Reveal className="order-last lg:order-first">
            <div className="relative mx-auto flex w-full max-w-sm items-end justify-center gap-3 pt-8 sm:max-w-md sm:gap-4">
              <div
                aria-hidden
                className="absolute inset-x-[10%] top-[20%] bottom-0 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-blue)_28%,transparent),transparent)]"
              />
              <PhoneFrame src={shot('companies')} alt={screenAlt('companies')} sizes="(min-width: 640px) 13rem, 44vw" className="w-[47%]" />
              <PhoneFrame src={shot('company')} alt={screenAlt('company')} sizes="(min-width: 640px) 13rem, 44vw" className="w-[47%] -translate-y-8" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* 8. The profile, and who sees it. */}
      <section aria-labelledby="get-app-profile" className="bg-muted/40">
        <div className={`${SECTION} grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16`}>
          <Reveal>
            <SectionHeader
              id="get-app-profile"
              eyebrow={t('profile.eyebrow')}
              title={t('profile.title')}
              body={t('profile.body')}
            />
          </Reveal>
          <Reveal delay={100}>
            <ProfileVisibilityDemo
              name={t('profile.name')}
              fields={[t('profile.areas'), t('profile.sales'), t('profile.cv')]}
              legend={t('profile.legend')}
              options={VISIBILITY.map((key) => ({
                key,
                label: tVisibility(key),
                hint: tVisibility(VISIBILITY_HINT[key]),
              }))}
            />
          </Reveal>
        </div>
      </section>

      {/* 9. The tour. */}
      <section aria-labelledby="get-app-tour" className={`${SECTION} overflow-hidden`}>
        <Reveal>
          <SectionHeader id="get-app-tour" align="center" eyebrow={t('tour.eyebrow')} title={t('tour.title')} />
        </Reveal>
        <ScreenTour
          className="mt-10 lg:mt-14"
          labels={{ list: t('tour.list'), prev: t('tour.prev'), next: t('tour.next') }}
          screens={SCREENS.map((key) => ({
            key,
            title: t(`tour.${key}`),
            body: t(`tour.${key}Body`),
            src: shot(key),
            alt: screenAlt(key),
          }))}
        />
      </section>

      {/* 10. Three steps to start. */}
      <section aria-labelledby="get-app-how" className={`${SECTION} border-t border-border`}>
        <Reveal>
          <SectionHeader id="get-app-how" align="center" eyebrow={t('how.eyebrow')} title={t('how.title')} />
        </Reveal>
        <ol className="relative mx-auto mt-12 grid max-w-4xl gap-10 sm:grid-cols-3 sm:gap-6">
          {/* The line through the three, from sm where they stand in a row. */}
          <span aria-hidden className="absolute inset-x-[16%] top-6 hidden h-px bg-border sm:block" />
          {[1, 2, 3].map((n, index) => (
            <Reveal key={n} as="li" delay={index * 120} className="relative flex flex-col items-center text-center">
              <span className="numeral grid size-12 place-items-center rounded-full border border-border bg-background text-lg font-bold text-primary">
                {n}
              </span>
              <span className="mt-4 block text-lg font-bold">{t(`how.step${n}Title`)}</span>
              <span className="mt-1 block text-muted-foreground">{t(`how.step${n}Body`)}</span>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* 11. The two doors. */}
      <section className={SECTION}>
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          <Reveal as="article" className="rounded-[1.5rem] border border-border bg-card p-7 text-center shadow-sm sm:p-9 lg:text-start">
            <h2 className="text-2xl font-bold">{t('audiences.seekerTitle')}</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">{t('audiences.seekerBody')}</p>
            <Button asChild className="mt-6">
              <Link href="/jobs">
                {t('audiences.seekerCta')}
                <ArrowRight className="rtl-flip" aria-hidden />
              </Link>
            </Button>
          </Reveal>
          <Reveal
            as="article"
            delay={100}
            className="rounded-[1.5rem] bg-[#0d1117] p-7 text-center text-white sm:p-9 lg:text-start [--ring:white]"
          >
            <h2 className="text-2xl font-bold">{t('audiences.employerTitle')}</h2>
            <p className="mt-3 leading-relaxed text-white/75">{t('audiences.employerBody')}</p>
            <Button asChild className="mt-6 bg-white text-slate-900 shadow-none hover:bg-white/90">
              <Link href={{ pathname: '/sign-in/employer', query: { next: '/employer/jobs/new' } }}>
                {t('audiences.employerCta')}
                <ArrowRight className="rtl-flip" aria-hidden />
              </Link>
            </Button>
          </Reveal>
        </div>
      </section>

      {/* 12. Questions. */}
      <section aria-labelledby="get-app-faq" className={`${SECTION} border-t border-border`}>
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <SectionHeader id="get-app-faq" align="center" eyebrow={t('faq.eyebrow')} title={t('faq.title')} />
          </Reveal>
          <Reveal delay={100}>
            <Faq
              className="mt-10"
              items={FAQ.map((n) => ({
                key: `q${n}`,
                question: t(`faq.q${n}`),
                answer:
                  n === 6
                    ? t.rich('faq.a6Rich', {
                        link: (chunks) => (
                          <Link href="/account-deletion" className="font-medium text-primary underline underline-offset-4">
                            {chunks}
                          </Link>
                        ),
                      })
                    : t(`faq.a${n}`),
              }))}
            />
          </Reveal>
        </div>
      </section>

      {/* 13. The ask, again. */}
      <section id="get-app-final" data-band aria-labelledby="get-app-final-heading" className={DARK}>
        <div
          aria-hidden
          className="absolute -top-1/2 end-[10%] -z-10 h-[46rem] w-[46rem] rounded-full bg-[radial-gradient(closest-side,rgba(42,79,246,0.45),transparent_72%)] will-change-transform motion-safe:animate-aurora"
        />
        <div className="shell grid items-center gap-8 pt-16 sm:pt-24 lg:grid-cols-2 lg:gap-16 lg:pt-28">
          <div className="text-center lg:pb-28 lg:text-start">
            <h2 id="get-app-final-heading" className="text-[clamp(1.75rem,1.3rem+1.8vw,3rem)] font-bold leading-tight text-balance">
              {t('final.title')}
            </h2>
            <p className="mt-3 text-lg text-white/75">{t('final.body')}</p>
            <StoreButtons labels={store} location="final" className="mt-8 justify-center lg:justify-start" />
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-white/65">
              <Check className="size-4 text-emerald-400" aria-hidden />
              {t('hero.trust')}
            </p>
          </div>
          {/* The phone leans in from the band's lower edge, its bottom third cropped. */}
          <div className="relative h-60 sm:h-72 lg:h-[26rem]">
            <PhoneFrame
              src={shot('home')}
              decorative
              sizes="(min-width: 1024px) 19rem, 14rem"
              className="absolute left-1/2 top-0 w-52 -translate-x-1/2 -rotate-[8deg] rtl:rotate-[8deg] sm:w-64 lg:w-[19rem]"
            />
          </div>
        </div>
      </section>
    </>
  );
}
