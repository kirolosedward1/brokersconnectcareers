import { getTranslations } from 'next-intl/server';
import { Banknote, BellRing, Check, EyeOff, Send } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { HeroPhone } from '@/components/get-app/hero-phone';
import { Walkthrough } from '@/components/get-app/walkthrough';
import { AppearanceSwitch } from '@/components/get-app/appearance-switch';
import { Reveal } from '@/components/get-app/reveal';
import { AppStoreBadge, GooglePlayBadge } from '@/components/get-app/store-badges';

/**
 * The page that gets somebody to install the app. docs/app-page.md is the
 * plan it is built to: one ask, made twice, with the app itself between —
 * the real captures from the iOS screens workflow, the five screens as a
 * consultant uses them, four things the phone adds, and the appearance
 * switch that proves the one claim best proved by trying it.
 *
 * Every claim here is one the store listing makes (mobile/store.config.js)
 * and the code backs. Every link is `#` until the app is in the store.
 *
 * The header floats over the hero the way it floats over /employers
 * (header-shell.tsx), which is why the hero clears it with its own padding.
 */

const SHOT = '/app-screenshots';

/** The walkthrough's screens, in the order the captures are taken. */
const STEPS = [
  { key: 'home', src: `${SHOT}/home.webp` },
  { key: 'jobs', src: `${SHOT}/jobs.webp` },
  { key: 'listing', src: `${SHOT}/listing.webp` },
  { key: 'companies', src: `${SHOT}/companies.webp` },
  { key: 'company', src: `${SHOT}/company.webp` },
] as const;

/** The hero shows the first three of them, one after another. */
const HERO_SCREENS = STEPS.slice(0, 3);

const FEATURES = [
  { key: 'pay', icon: Banknote },
  { key: 'apply', icon: Send },
  { key: 'follow', icon: BellRing },
  { key: 'profile', icon: EyeOff },
] as const;

const APPEARANCES = [
  { key: 'light', src: `${SHOT}/home.webp` },
  { key: 'dark', src: `${SHOT}/dark/home.webp` },
  { key: 'large', src: `${SHOT}/large-text/home.webp` },
] as const;

export async function GetAppLanding() {
  const t = await getTranslations('appPage');

  const badges = (
    <>
      <AppStoreBadge label={t('badges.appStoreLabel')} top={t('badges.appStoreTop')} />
      <GooglePlayBadge
        label={t('badges.googlePlayLabel')}
        top={t('badges.googlePlayTop')}
        comingSoon={t('badges.comingSoon')}
      />
    </>
  );

  const screenAlt = (key: (typeof STEPS)[number]['key']) =>
    t('screens.alt', { screen: t(`screens.${key}`) });

  return (
    <>
      {/* Focus rings are white over the gradient, as in the other heroes:
          the brand blue measured under 3:1 against it. */}
      <section
        className="relative isolate overflow-hidden bg-[linear-gradient(135deg,#0b1020_0%,#141c3a_45%,#0e2b47_100%)] text-white [--ring:white]"
        aria-labelledby="get-app-heading"
      >
        {/* The aurora: two soft lights drifting behind the words, transform
            only, a long loop, still under reduced motion. */}
        <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-[40%] start-[45%] h-[60rem] w-[60rem] rounded-full bg-[radial-gradient(closest-side,rgba(42,79,246,0.55),transparent_72%)] will-change-transform motion-safe:animate-aurora" />
          <div className="absolute -bottom-[45%] -start-[20%] h-[50rem] w-[50rem] rounded-full bg-[radial-gradient(closest-side,rgba(92,225,230,0.32),transparent_72%)] will-change-transform motion-safe:animate-aurora-slow" />
        </div>

        {/* Words at the start, the phone at the end — the right of the page
            in English and the left in Arabic, because the grid is logical. */}
        <div className="shell grid gap-10 pt-24 sm:pt-28 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16 lg:pb-16 lg:pt-36">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-white/65">{t('hero.eyebrow')}</p>
            <h1
              id="get-app-heading"
              className="mt-3 text-3xl font-bold leading-[1.2] text-balance sm:text-4xl lg:text-5xl"
            >
              {t('hero.title')}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-white/75 sm:text-lg">
              {t('hero.subtitle')}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">{badges}</div>

            <p className="mt-5 inline-flex items-center gap-1.5 text-sm text-white/65">
              <Check className="size-4 text-emerald-400" aria-hidden />
              {t('hero.note')}
            </p>
          </div>

          {/* Below lg the phone rises out of the band's lower edge, its bottom
              fifth cropped by the section; from lg it stands whole, with the
              dots under it. */}
          <div className="relative mx-auto w-60 sm:w-64 lg:w-[17rem] lg:justify-self-end">
            <div
              aria-hidden
              className="absolute -inset-x-24 -top-12 -bottom-4 -z-10 bg-[radial-gradient(closest-side,rgba(92,225,230,0.22),transparent)]"
            />
            <HeroPhone
              screens={HERO_SCREENS.map((screen) => ({ src: screen.src, alt: screenAlt(screen.key) }))}
              sizes="(min-width: 1024px) 17rem, 16rem"
              dotLabels={HERO_SCREENS.map((_, index) =>
                t('hero.showScreen', { n: index + 1, total: HERO_SCREENS.length }),
              )}
              className="-mb-28 lg:mb-0"
            />
          </div>
        </div>
      </section>

      <section className="shell py-14 sm:py-16" aria-labelledby="get-app-screens-heading">
        <Reveal as="header" className="max-w-2xl">
          <h2 id="get-app-screens-heading" className="text-2xl font-bold text-balance sm:text-3xl">
            {t('screens.title')}
          </h2>
          <p className="mt-2 leading-relaxed text-muted-foreground">{t('screens.subtitle')}</p>
        </Reveal>

        <Walkthrough
          className="mt-8 lg:mt-4"
          labels={{ list: t('screens.list'), prev: t('screens.prev'), next: t('screens.next') }}
          steps={STEPS.map((step) => ({
            key: step.key,
            title: t(`screens.${step.key}`),
            body: t(`screens.${step.key}Body`),
            src: step.src,
            alt: screenAlt(step.key),
          }))}
        />
      </section>

      <section className="border-t border-border bg-muted/40" aria-labelledby="get-app-features-heading">
        <div className="shell py-14 sm:py-16">
          <Reveal as="header">
            <h2 id="get-app-features-heading" className="text-2xl font-bold text-balance sm:text-3xl">
              {t('features.title')}
            </h2>
          </Reveal>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ key, icon: Icon }, index) => (
              <Reveal key={key} as="li" delay={index * 70}>
                <Card className="group h-full p-5 transition-[border-color,transform] duration-200 ease-out hover:border-primary/40 motion-safe:hover:-translate-y-0.5">
                  <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-semibold leading-snug">{t(`features.${key}Title`)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {t(`features.${key}Body`)}
                  </p>
                </Card>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-border" aria-labelledby="get-app-appearance-heading">
        <div className="shell grid gap-10 py-14 sm:py-16 lg:grid-cols-2 lg:items-center lg:gap-16">
          <Reveal as="header" className="max-w-xl">
            <h2 id="get-app-appearance-heading" className="text-2xl font-bold text-balance sm:text-3xl">
              {t('appearance.title')}
            </h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{t('appearance.subtitle')}</p>
          </Reveal>

          <AppearanceSwitch
            legend={t('appearance.legend')}
            options={APPEARANCES.map((appearance) => ({
              key: appearance.key,
              label: t(`appearance.${appearance.key}`),
              src: appearance.src,
              alt: t('appearance.alt', {
                appearance: t(
                  appearance.key === 'light'
                    ? 'appearance.altLight'
                    : appearance.key === 'dark'
                      ? 'appearance.altDark'
                      : 'appearance.altLarge',
                ),
              }),
            }))}
          />
        </div>
      </section>

      {/* The ask again, as a line, where the page's other bands are. */}
      <section data-band className="border-t border-border bg-muted/40">
        <div className="shell flex flex-col gap-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:gap-10">
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold text-balance">{t('band.title')}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('band.body')}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">{badges}</div>
        </div>
      </section>
    </>
  );
}
