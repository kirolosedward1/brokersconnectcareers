import { getTranslations } from 'next-intl/server';
import { Banknote, BellRing, Check, EyeOff, Send } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PhoneFrame } from '@/components/get-app/phone-frame';
import { AppStoreBadge, GooglePlayBadge } from '@/components/get-app/store-badges';

/**
 * The page that gets somebody to install the app.
 *
 * One ask, made twice: the badges open the page and close it, with the
 * evidence between them — the screens themselves, then the four things a
 * consultant gets out of carrying the board in a pocket. Every claim here is
 * one the store listing makes and the code backs (mobile/store.config.js):
 * the pay in figures, the lead source on every listing, one-tap applications,
 * a notification when an application moves, the directory profile the
 * consultant controls.
 *
 * The hero is the landing pages' own first screen — the same gradient the
 * film plays over there, without the film — so the three pages read as one
 * product. The header floats over it the way it floats over /employers
 * (header-shell.tsx), which is why the hero clears it with its own padding.
 *
 * Every link is `#` until the app is in the store.
 */

/**
 * The screens, in the order the app's tabs put them.
 *
 * Stand-ins until the App Store set exists (docs/app-store.md, "Screenshots"):
 * wireframes in the app's own palette, each labelled with its file name, so
 * they are swapped by dropping the captures over them. Their size is the
 * capture's own, 1179 by 2556.
 */
const SCREENS = [
  { key: 'home', src: '/app-screenshots/screen-1.png' },
  { key: 'jobs', src: '/app-screenshots/screen-2.png' },
  { key: 'applications', src: '/app-screenshots/screen-3.png' },
  { key: 'saved', src: '/app-screenshots/screen-4.png' },
  { key: 'profile', src: '/app-screenshots/screen-5.png' },
] as const;

/** One card per screen the gallery shows, less the home screen, which is all of them. */
const FEATURES = [
  { key: 'pay', icon: Banknote },
  { key: 'apply', icon: Send },
  { key: 'follow', icon: BellRing },
  { key: 'profile', icon: EyeOff },
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

  const [hero] = SCREENS;

  return (
    <>
      {/* Focus rings are white over the gradient, as they are in the other
          heroes: the brand blue measured under 3:1 against it. */}
      <section
        className="relative isolate overflow-hidden bg-[linear-gradient(135deg,#0b1020_0%,#141c3a_45%,#0e2b47_100%)] text-white [--ring:white]"
        aria-labelledby="get-app-heading"
      >
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-60 bg-[radial-gradient(60rem_32rem_at_75%_-10%,var(--brand-blue),transparent_70%),radial-gradient(40rem_24rem_at_10%_110%,var(--brand-cyan),transparent_75%)]"
        />

        {/* Words at the start, the phone at the end — the right of the page
            in English and the left in Arabic, because the grid is logical.
            The top padding clears the floating header, as HeroShell's does. */}
        <div className="shell grid gap-10 pt-24 sm:pt-28 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
          <div className="max-w-xl lg:py-16">
            <h1
              id="get-app-heading"
              className="text-3xl font-bold leading-[1.2] text-balance sm:text-4xl lg:text-5xl"
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

          {/* The phone rises out of the band's lower edge rather than sitting
              whole inside it: the bottom fifth is cropped by the section,
              which is what makes it read as a device being held up and not
              as a picture of one. A cyan wash behind it keeps the dark frame
              off the dark ground. */}
          <div className="relative mx-auto w-60 sm:w-64 lg:w-72 lg:justify-self-end">
            <div
              aria-hidden
              className="absolute -inset-x-24 -top-12 -bottom-4 -z-10 bg-[radial-gradient(closest-side,rgba(92,225,230,0.22),transparent)]"
            />
            <PhoneFrame
              src={hero.src}
              alt={t('screens.alt', { screen: t(`screens.${hero.key}`) })}
              sizes="(min-width: 1024px) 18rem, 16rem"
              priority
              className="-mb-28 lg:-mb-24"
            />
          </div>
        </div>
      </section>

      <section className="shell py-12 sm:py-14" aria-labelledby="get-app-screens-heading">
        <div className="max-w-2xl">
          <h2 id="get-app-screens-heading" className="text-xl font-bold text-balance sm:text-2xl">
            {t('screens.title')}
          </h2>
          <p className="mt-2 leading-relaxed text-muted-foreground">{t('screens.subtitle')}</p>
        </div>

        {/* One row, scrolled, on a phone — bleeding to the page's edges so a
            partly visible frame says the row goes on, the way ChipRow does —
            and five across from `lg`, every other one dropped a step so the
            row reads as a hand of cards rather than a shelf. No scrollbar: it
            is chrome on a row of pictures. */}
        <ul className="-mx-4 mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-5 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0">
          {SCREENS.map((screen) => {
            const caption = t(`screens.${screen.key}`);
            return (
              <li
                key={screen.key}
                className="w-[13.5rem] shrink-0 snap-center sm:w-60 lg:w-auto lg:even:mt-12"
              >
                <figure>
                  <PhoneFrame
                    src={screen.src}
                    alt={t('screens.alt', { screen: caption })}
                    sizes="(min-width: 1024px) 14rem, 15rem"
                  />
                  <figcaption className="mt-3 text-center text-sm font-medium">{caption}</figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="border-t border-border" aria-labelledby="get-app-features-heading">
        <div className="shell py-12 sm:py-14">
          <h2 id="get-app-features-heading" className="text-xl font-bold text-balance sm:text-2xl">
            {t('features.title')}
          </h2>

          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ key, icon: Icon }) => (
              <li key={key}>
                <Card className="h-full p-5">
                  <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-semibold leading-snug">{t(`features.${key}Title`)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {t(`features.${key}Body`)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
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
