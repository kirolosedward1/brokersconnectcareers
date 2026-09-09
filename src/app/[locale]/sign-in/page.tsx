import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, type Locale } from '@/i18n/routing';
import { AuthForm } from '@/components/auth/auth-form';
import { AudienceSwitch } from '@/components/auth/audience-switch';
import { AuthShell } from '../auth-shell';
import { enabledProviders } from '@/lib/auth-providers';

/**
 * Rendered per request, not prerendered.
 *
 * AuthForm reads useSearchParams (for `next`), and under static generation that
 * bails its Suspense boundary out to the client — so the page shipped a heading
 * and an empty shell, and the form only appeared once ~200kB of JavaScript had
 * loaded and hydrated. On the screen that decides whether somebody gets an
 * account, on a Cairo mobile connection, that is the wrong trade.
 *
 * These pages were dynamic by accident until now: the site header sat in the
 * root layout and read cookies, which opted every route into dynamic
 * rendering. Moving the header into the (site) layout — so the console cannot
 * inherit one — took that away and quietly turned the auth screens static.
 * Saying it out loud is better than depending on a header three layouts up.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signIn'), robots: { index: false, follow: false } };
}

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const { google: googleEnabled } = await enabledProviders();
  const t = await getTranslations('auth');

  return (
    <AuthShell>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold">{t('signInTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            {t('signUp')}
          </Link>
        </p>

        <div className="mt-8">
          <AudienceSwitch mode="sign-in" />
        </div>

        <div className="mt-6">
          <Suspense>
            <AuthForm mode="sign-in" locale={locale} googleEnabled={googleEnabled} />
          </Suspense>
        </div>
      </div>
    </AuthShell>
  );
}
