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
import { ContactStep, PostStep, VerifyStep } from '@/components/home/employer-steps';
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

        <h1 className="rise-in mt-2 text-4xl font-bold leading-[1.15] text-balance text-white sm:text-6xl">
          {t('employerHero.title')}
        </h1>

        <p className="rise-in [--rise-delay:210ms] mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/75">
          {t('employerHero.subtitle')}
        </p>

        <div className="rise-in [--rise-delay:280ms] mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-13 rounded-full px-8">
            <Link href={postHref}>{t('employerHero.cta')}</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="h-13 rounded-full border border-white/20 px-7 text-white hover:bg-white/10"
          >
            <Link href="/agents">{t('employerHero.ctaSecondary')}</Link>
          </Button>
        </div>

        {/* Three numbers rather than three claims. The first is live from the
            directory; the other two are policy, and policy is a fact. */}
        <dl className="rise-in [--rise-delay:350ms] mt-12 grid w-full max-w-lg grid-cols-3 gap-4">
          {[
            [formatNumber(consultantCount, locale), t('employerHero.stat1')],
            [formatNumber(30, locale), t('employerHero.stat2')],
            [formatNumber(0, locale), t('employerHero.stat3')],
          ].map(([value, label]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-4">
              <dt className="numeral text-2xl font-bold text-white">{value}</dt>
              <dd className="mt-1 text-xs leading-snug text-white/60">{label}</dd>
            </div>
          ))}
        </dl>

        <p className="rise-in [--rise-delay:420ms] mt-8 inline-flex items-center gap-1.5 text-sm text-white/60">
          <Check className="size-4 text-emerald-400" aria-hidden />
          {t('employerHero.trustFree')}
        </p>
      </HeroShell>

      <section className="mx-auto max-w-6xl px-4 py-24" aria-labelledby="employer-why">
        <div className="reveal mx-auto max-w-2xl text-center">
          <h2 id="employer-why" className="text-3xl font-bold text-balance sm:text-4xl">
            {t('employerWhy.title')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t('employerWhy.subtitle')}
          </p>
        </div>

        {/* No cards. Six bordered tiles gave six claims the same weight and put
            a box around each one; columns let the type do the work, and the
            one coloured tile says which argument the other five support. */}
        <ul className="reveal mt-16 grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              [Target, 'kindClarity', 'clarityTitle', 'clarityBody', true],
              [Users, 'kindNiche', 'nicheTitle', 'nicheBody', false],
              [ClipboardList, 'kindPipeline', 'pipelineTitle', 'pipelineBody', false],
              [BadgeCheck, 'kindVerified', 'verifiedTitle', 'verifiedBody', false],
              [LayoutGrid, 'kindSeats', 'seatsTitle', 'seatsBody', false],
              [CalendarClock, 'kindFresh', 'freshTitle', 'freshBody', false],
            ] as const
          ).map(([Icon, kind, title, body, lead]) => (
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
                {t(`employerWhy.${kind}`)}
              </p>

              <h3 className="mt-1.5 text-lg font-semibold leading-snug text-balance">
                {t(`employerWhy.${title}`)}
              </h3>

              <p className="mt-3 leading-relaxed text-muted-foreground">
                {t(`employerWhy.${body}`)}
              </p>

              {/* Only under the lead: the three fields the form insists on,
                  shown rather than asserted. */}
              {lead ? (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {(['proofSalary', 'proofCommission', 'proofLeads'] as const).map((key) => (
                    <li
                      key={key}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                    >
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
        <div className="mx-auto max-w-6xl px-4 py-24">
          <h2
            id="employer-how"
            className="reveal mb-12 text-center text-3xl font-bold text-balance sm:text-4xl"
          >
            {t('how.title')}
          </h2>

          <StepTabs
            className="reveal"
            steps={[
              {
                key: 'employer1',
                title: t('how.employer1Title'),
                body: t('how.employer1Body'),
                illustration: <VerifyStep className="h-auto w-full max-w-lg" />,
              },
              {
                key: 'employer2',
                title: t('how.employer2Title'),
                body: t('how.employer2Body'),
                illustration: <PostStep className="h-auto w-full max-w-lg" />,
              },
              {
                key: 'employer3',
                title: t('how.employer3Title'),
                body: t('how.employer3Body'),
                illustration: <ContactStep className="h-auto w-full max-w-lg" />,
              },
            ]}
          />
        </div>
      </section>

      {/* Pricing, priced at zero while BILLING_ENABLED is off — showing the
          real tiers now means the day it flips is not a surprise. */}
      <section className="mx-auto max-w-6xl px-4 py-20" aria-labelledby="employer-packs">
        <h2 id="employer-packs" className="reveal text-center text-2xl font-bold sm:text-3xl">
          {t('employerHero.trustFree')}
        </h2>

        <ul className="reveal mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {POST_PACKS.map((pack) => (
            <li key={pack.key} className="lift rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">{pack.key}</p>
              <p className="numeral mt-2 text-2xl font-bold">
                {BILLING_ENABLED ? formatEgp(pack.priceEgp, locale) : formatEgp(0, locale)}
              </p>
              {BILLING_ENABLED ? null : (
                <p className="numeral mt-1 text-xs text-muted-foreground line-through">
                  {formatEgp(pack.priceEgp, locale)}
                </p>
              )}
              <p className="numeral mt-3 text-sm text-muted-foreground">
                {pack.seats ? formatNumber(pack.seats, locale) : '∞'} · {formatNumber(pack.days, locale)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
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
              <Link href={postHref}>{t('employerBand.cta')}</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
