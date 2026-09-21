import { getTranslations } from 'next-intl/server';
import {
  BadgeCheck,
  CalendarClock,
  Check,
  ClipboardList,
  LayoutGrid,
  Target,
  Users,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { HeroShell } from '@/components/home/hero-shell';
import { StepTabs } from '@/components/home/step-tabs';
import { Illustration } from '@/components/illustration';
import { POST_PACKS } from '@/lib/taxonomy';
import { BILLING_ENABLED } from '@/lib/env';
import { formatEgp, formatNumber } from '@/lib/utils';

/**
 * The hiring side of the marketplace.
 *
 * Not a rearrangement of the candidate page: an employer arrives with a
 * different question — will this bring me people worth interviewing — and
 * every section here answers that one rather than explaining what a job board
 * is. The shared hero shell keeps it recognisably the same product.
 */
export async function EmployerLanding({
  locale,
  consultantCount,
  signedIn,
}: {
  locale: Locale;
  consultantCount: number;
  /** Decides where "post a job" goes for somebody with no account yet. */
  signedIn: boolean;
}) {
  const t = await getTranslations('landingPage');

  // A signed-out visitor sent to the posting form bounces off the auth wall and
  // arrives at a generic sign-in, having lost the fact that they are an
  // employer. Send them through the employer door instead.
  const postHref = signedIn ? '/employer/jobs/new' : '/sign-up/employer';

  return (
    <>
      <HeroShell>

        <h1 className="text-3xl font-bold leading-[1.2] text-balance text-white sm:text-4xl lg:text-5xl">
          {t('employerHero.title')}
        </h1>

        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
          {t('employerHero.subtitle')}
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="px-8">
            <Link href={postHref}>{t('employerHero.cta')}</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="border border-white/25 px-7 text-white hover:bg-white/10"
          >
            <Link href="/agents">{t('employerHero.ctaSecondary')}</Link>
          </Button>
        </div>

        {/* Three numbers rather than three claims. The first is live from the
            directory; the other two are policy, and policy is a fact. */}
        {/* A ruled row, not three frosted tiles: the figures are one
            statement in three parts and read as one line. */}
        <dl className="mt-8 grid w-full max-w-lg grid-cols-3 divide-x divide-white/15 rtl:divide-x-reverse">
          {[
            [formatNumber(consultantCount, locale), t('employerHero.stat1')],
            [formatNumber(30, locale), t('employerHero.stat2')],
            [formatNumber(0, locale), t('employerHero.stat3')],
          ].map(([value, label]) => (
            <div key={label} className="px-3">
              <dt className="text-xl font-bold text-white sm:text-2xl">
                <span className="numeral">{value}</span>
              </dt>
              <dd className="mt-0.5 text-xs leading-snug text-white/60">{label}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 inline-flex items-center gap-1.5 text-sm text-white/65">
          <Check className="size-4 text-emerald-400" aria-hidden />
          {t('employerHero.trustFree')}
        </p>
      </HeroShell>

      <section className="shell py-12 sm:py-14" aria-labelledby="employer-why">
        <div className="max-w-2xl">
          <h2 id="employer-why" className="text-xl font-bold text-balance sm:text-2xl">
            {t('employerWhy.title')}
          </h2>
          <p className="mt-2 leading-relaxed text-muted-foreground">{t('employerWhy.subtitle')}</p>
        </div>

        {/* The same ruled list the candidates' page uses for its six claims —
            one product, two doors. The lead argument keeps the brand colour on
            its mark and its three proofs; nothing sits in a tile. */}
        <ul className="mt-5 grid gap-x-10 border-t border-border sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              [Target, 'clarityTitle', 'clarityBody', true],
              [Users, 'nicheTitle', 'nicheBody', false],
              [ClipboardList, 'pipelineTitle', 'pipelineBody', false],
              [BadgeCheck, 'verifiedTitle', 'verifiedBody', false],
              [LayoutGrid, 'seatsTitle', 'seatsBody', false],
              [CalendarClock, 'freshTitle', 'freshBody', false],
            ] as const
          ).map(([Icon, title, body, lead]) => (
            <li key={title} className="border-b border-border py-5">
              <h3 className="flex items-center gap-2 font-semibold leading-snug">
                <Icon
                  className={lead ? 'size-4 shrink-0 text-primary' : 'size-4 shrink-0 text-muted-foreground'}
                  aria-hidden
                />
                {t(`employerWhy.${title}`)}
              </h3>

              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {t(`employerWhy.${body}`)}
              </p>

              {/* Only under the lead: the three fields the form insists on,
                  shown rather than asserted. */}
              {lead ? (
                <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-primary">
                  {(['proofSalary', 'proofCommission', 'proofLeads'] as const).map((key) => (
                    <li key={key} className="inline-flex items-center gap-1">
                      <Check className="size-3.5" aria-hidden />
                      {t(`employerWhy.${key}`)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-border bg-muted/40" aria-labelledby="employer-how">
        <div className="shell py-12 sm:py-14">
          <h2 id="employer-how" className="mb-8 text-xl font-bold text-balance sm:text-2xl">
            {t('how.title')}
          </h2>

          <StepTabs
            
            steps={[
              {
                key: 'employer1',
                title: t('how.employer1Title'),
                body: t('how.employer1Body'),
                illustration: <Illustration name="verify" className="max-w-md" />,
              },
              {
                key: 'employer2',
                title: t('how.employer2Title'),
                body: t('how.employer2Body'),
                illustration: <Illustration name="write" className="max-w-md" />,
              },
              {
                key: 'employer3',
                title: t('how.employer3Title'),
                body: t('how.employer3Body'),
                illustration: <Illustration name="review" className="max-w-md" />,
              },
            ]}
          />
        </div>
      </section>

      {/* Pricing, priced at zero while BILLING_ENABLED is off — showing the
          real tiers now means the day it flips is not a surprise. */}
      <section className="shell py-12 sm:py-14" aria-labelledby="employer-packs">
        <h2 id="employer-packs" className="text-xl font-bold sm:text-2xl">
          {t('employerHero.trustFree')}
        </h2>

        <ul className="mt-5 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {POST_PACKS.map((pack) => (
            <li key={pack.key} className="bg-card p-5">
              <p className="text-sm font-medium text-muted-foreground">{pack.key}</p>
              <p className="mt-2 text-2xl font-bold">
                <span className="numeral">
                  {BILLING_ENABLED ? formatEgp(pack.priceEgp, locale) : formatEgp(0, locale)}
                </span>
              </p>
              {BILLING_ENABLED ? null : (
                <p className="numeral mt-1 text-xs text-muted-foreground line-through">
                  {formatEgp(pack.priceEgp, locale)}
                </p>
              )}
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="numeral">
                  {pack.seats ? formatNumber(pack.seats, locale) : '∞'} · {formatNumber(pack.days, locale)}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* The closing ask, as a line. It was a gradient poster with a grid
          masked into it; by this point the reader has had the hero's button
          and the header's the whole way down. */}
      <section className="border-t border-border bg-muted/40">
        <div className="shell flex flex-col gap-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:gap-10">
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold text-balance">{t('employerBand.title')}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t('employerBand.body')}
            </p>
          </div>
          <Button asChild className="shrink-0">
            <Link href={postHref}>{t('employerBand.cta')}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
