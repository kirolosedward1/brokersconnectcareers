import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/logo';

/**
 * The sign-in and sign-up screens: form on one side, brand panel on the other.
 *
 * The site header steps aside on these routes (see HeaderShell), so the logo
 * lives here instead — a nav bar full of links is an invitation to wander off
 * mid-task, which is the last thing a half-finished sign-up needs. The same
 * reasoning already keeps the footer off these pages.
 *
 * The panel is not decoration. On the widest screens it is half the viewport,
 * and half a viewport of gradient says nothing; these three lines are the
 * reasons somebody is filling the form in, put where they can see them while
 * they do it. Below lg it disappears rather than stacking — on a phone it
 * would push the form under the fold.
 */
export type Audience = 'candidate' | 'employer';

export async function AuthShell({
  children,
  audience,
}: {
  children: React.ReactNode;
  /** Swaps the panel's argument. Omitted on the neutral routes. */
  audience?: Audience;
}) {
  const t = await getTranslations('auth');
  const tMeta = await getTranslations('meta');

  const panel =
    audience === 'employer'
      ? {
          title: t('panelTitleEmployer'),
          points: ['panelEmployer1', 'panelEmployer2', 'panelEmployer3'] as const,
        }
      : {
          title: t('panelTitle'),
          points: ['panelPoint1', 'panelPoint2', 'panelPoint3'] as const,
        };

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-10 sm:px-12">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label={tMeta('siteName')}>
            <Logo name={tMeta('siteName')} />
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="rtl-flip size-4" aria-hidden />
            {t('backHome')}
          </Link>
        </div>

        <div className="flex flex-1 flex-col justify-center py-12">{children}</div>
      </div>

      {/* Fixed so it does not scroll with a long form, and hidden below lg. */}
      <aside
        aria-hidden
        className="bg-brand-gradient relative hidden overflow-hidden lg:block"
      >
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:2.5rem_2.5rem] [mask-image:radial-gradient(36rem_24rem_at_50%_30%,black,transparent)]" />
        <div className="pointer-events-none absolute -bottom-24 -start-24 size-96 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex h-full flex-col justify-center gap-8 px-14 text-primary-foreground">
          <p className="max-w-md text-3xl font-bold leading-snug text-balance">
            {panel.title}
          </p>

          <ul className="space-y-4">
            {panel.points.map((key) => (
              <li key={key} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/20">
                  <Check className="size-3.5" />
                </span>
                <span className="max-w-sm leading-relaxed opacity-90">{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
