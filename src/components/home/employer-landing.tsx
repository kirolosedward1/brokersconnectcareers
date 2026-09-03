import { getTranslations } from 'next-intl/server';
import {
  BadgeCheck,
  CalendarClock,
  Check,
  ClipboardList,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { HeroShell } from '@/components/home/hero-shell';
import { EmployerIllustration } from '@/components/home/illustrations';
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
}: {
  locale: Locale;
  consultantCount: number;
}) {
  const t = await getTranslations('landingPage');

  return (
    <>
      <HeroShell>
        <span className="rise-in [--rise-delay:70ms] inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
          <Sparkles className="size-3.5" aria-hidden />
          {t('employerHero.eyebrow')}
        </span>

        <h1 className="rise-in [--rise-delay:140ms] mt-6 text-4xl font-bold leading-[1.15] text-balance text-white sm:text-6xl">
          {t('employerHero.title')}
        </h1>

        <p className="rise-in [--rise-delay:210ms] mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/75">
          {t('employerHero.subtitle')}
        </p>

        <div className="rise-in [--rise-delay:280ms] mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-13 rounded-full px-8">
            <Link href="/employer/jobs/new">{t('employerHero.cta')}</Link>
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

      <section className="mx-auto max-w-6xl px-4 py-20" aria-labelledby="employer-why">
        <div className="reveal mx-auto max-w-2xl text-center">
          <h2 id="employer-why" className="text-2xl font-bold text-balance sm:text-3xl">
            {t('employerWhy.title')}
          </h2>
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
            {t('employerWhy.subtitle')}
          </p>
        </div>

        {/* Six equal cards made six equal claims, and one of these is the
            argument the other five support. The grid gives it the room to say
            so: a wide lead card that shows the three fields rather than
            asserting them, then a descending rhythm of supporting points. */}
        <div className="reveal mt-12 grid gap-4 lg:grid-cols-6">
          <article className="lift relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.04] p-7 shadow-sm lg:col-span-4">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.07] bg-[radial-gradient(24rem_14rem_at_85%_0%,var(--brand-blue),transparent_70%)]"
            />
            <span
              aria-hidden
              className="bg-brand-gradient relative grid size-12 place-items-center rounded-xl text-primary-foreground shadow-[var(--shadow-primary)]"
            >
              <Target className="size-6" />
            </span>

            <h3 className="relative mt-5 text-xl font-semibold">
              {t('employerWhy.clarityTitle')}
            </h3>
            <p className="relative mt-2 max-w-lg leading-relaxed text-muted-foreground">
              {t('employerWhy.clarityBody')}
            </p>

            <p className="relative mt-6 text-xs font-medium uppercase tracking-wide text-primary">
              {t('employerWhy.proofLabel')}
            </p>
            <ul className="relative mt-2 flex flex-wrap gap-2">
              {(['proofSalary', 'proofCommission', 'proofLeads'] as const).map((key) => (
                <li
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-card px-3 py-1.5 text-sm font-medium shadow-xs"
                >
                  <Check className="size-3.5 text-primary" aria-hidden />
                  {t(`employerWhy.${key}`)}
                </li>
              ))}
            </ul>
          </article>

          <article className="lift rounded-2xl border border-border bg-card p-6 shadow-sm lg:col-span-2">
            <span
              aria-hidden
              className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground"
            >
              <Users className="size-5" />
            </span>
            <h3 className="mt-4 font-semibold">{t('employerWhy.nicheTitle')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t('employerWhy.nicheBody')}
            </p>
          </article>

          {(
            [
              [ClipboardList, 'pipelineTitle', 'pipelineBody'],
              [BadgeCheck, 'verifiedTitle', 'verifiedBody'],
              [Users, 'seatsTitle', 'seatsBody'],
            ] as const
          ).map(([Icon, title, body]) => (
            <article
              key={title}
              className="lift rounded-2xl border border-border bg-card p-6 shadow-sm lg:col-span-2"
            >
              <span
                aria-hidden
                className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground"
              >
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{t(`employerWhy.${title}`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`employerWhy.${body}`)}
              </p>
            </article>
          ))}

          {/* The last one is a rule the platform enforces on the employer's
              behalf, so it reads as a closing line rather than a sixth tile. */}
          <article className="lift flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center lg:col-span-6">
            <span
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
            >
              <CalendarClock className="size-5" />
            </span>
            <div>
              <h3 className="font-semibold">{t('employerWhy.freshTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t('employerWhy.freshBody')}
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="border-y border-border bg-muted/40" aria-labelledby="employer-how">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 id="employer-how" className="reveal mb-10 text-center text-2xl font-bold sm:text-3xl">
            {t('how.title')}
          </h2>

          <div className="reveal grid items-center gap-12 lg:grid-cols-2">
            <EmployerIllustration className="mx-auto h-auto w-full max-w-md" />

            <ol className="space-y-6">
              {(['employer1', 'employer2', 'employer3'] as const).map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span
                    aria-hidden
                    className="bg-brand-gradient numeral grid size-9 shrink-0 place-items-center rounded-xl font-bold text-primary-foreground"
                  >
                    {formatNumber(index + 1, locale)}
                  </span>
                  <div>
                    <h3 className="font-semibold">{t(`how.${step}Title`)}</h3>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {t(`how.${step}Body`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
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
              <Link href="/employer/jobs/new">{t('employerBand.cta')}</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
