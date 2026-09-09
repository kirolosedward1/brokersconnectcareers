import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { AuthForm } from '@/components/auth/auth-form';
import { AudienceSwitch } from '@/components/auth/audience-switch';
import { AuthShell, type Audience } from '../../auth-shell';
import { enabledProviders } from '@/lib/auth-providers';

const AUDIENCES = ['candidate', 'employer'] as const;

function parse(value: string): Audience {
  if (!(AUDIENCES as readonly string[]).includes(value)) notFound();
  return value as Audience;
}

export function generateStaticParams() {
  return AUDIENCES.map((audience) => ({ audience }));
}

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
  params: Promise<{ locale: string; audience: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale, audience: rawAudience } = await params;
  const locale = asLocale(rawLocale);
  const audience = parse(rawAudience);
  const t = await getTranslations({ locale, namespace: 'auth' });

  return {
    title: audience === 'employer' ? t('signUpTitleEmployer') : t('signUpTitleCandidate'),
    robots: { index: false, follow: false },
  };
}

/**
 * Sign-up for one side of the marketplace.
 *
 * The door somebody came through is an answer to the question onboarding
 * would otherwise ask, so the role travels with them. It arrives pre-selected
 * rather than locked in silently: the choice cannot be changed after the
 * account exists, and a permanent decision should not be made by a URL the
 * person may not have read.
 */
export default async function AudienceSignUpPage({
  params,
}: {
  params: Promise<{ locale: string; audience: string }>;
}) {
  const { locale: rawLocale, audience: rawAudience } = await params;
  const locale = asLocale(rawLocale);
  const audience = parse(rawAudience);
  setRequestLocale(locale);

  const { google: googleEnabled } = await enabledProviders();

  const t = await getTranslations('auth');

  return (
    <AuthShell audience={audience}>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold">
          {audience === 'employer' ? t('signUpTitleEmployer') : t('signUpTitleCandidate')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('haveAccount')}{' '}
          <Link href={`/sign-in/${audience}`} className="font-medium text-primary hover:underline">
            {t('signIn')}
          </Link>
        </p>

        <div className="mt-8">
          <AudienceSwitch mode="sign-up" active={audience} />
        </div>

        <div className="mt-6">
          <Suspense>
            <AuthForm mode="sign-up" locale={locale} audience={audience} googleEnabled={googleEnabled} />
          </Suspense>
        </div>
      </div>
    </AuthShell>
  );
}
