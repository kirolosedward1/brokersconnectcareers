import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/logo';
import { BrandPanel } from '@/components/auth/brand-panel';

/**
 * The sign-in and sign-up screens: form on one side, brand panel on the other.
 *
 * The site header steps aside on these routes (see HeaderShell), so the logo
 * lives here instead — a nav bar full of links is an invitation to wander off
 * mid-task, which is the last thing a half-finished sign-up needs. The same
 * reasoning already keeps the footer off these pages.
 *
 * The panel is the same component for both doors. Below lg it is not drawn:
 * on a phone it would push the form under the fold.
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

  return (
    <main id="main" tabIndex={-1} className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-10 sm:px-12">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label={tMeta('siteName')} className="flex min-h-11 items-center">
            <Logo name={tMeta('siteName')} />
          </Link>

          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="rtl-flip size-4" aria-hidden />
            {t('backHome')}
          </Link>
        </div>

        <div className="flex flex-1 flex-col justify-center py-12">{children}</div>
      </div>

      <BrandPanel audience={audience} />
    </main>
  );
}
