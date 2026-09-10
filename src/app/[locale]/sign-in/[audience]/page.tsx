import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { AuthForm } from '@/components/auth/auth-form';
import { AudienceSwitch } from '@/components/auth/audience-switch';
import { ReturnIntent } from '@/components/auth/return-intent';
import { safeNext } from '@/lib/safe-next';
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
  parse(rawAudience);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signIn'), robots: { index: false, follow: false } };
}

/**
 * Sign-in for one side of the marketplace — an entry point, not a variant.
 *
 * The panel copy differs so a campaign can land employers somewhere that talks
 * to employers. Everything else is identical, and deliberately so: an account
 * already knows what it is, and where somebody lands afterwards comes from
 * their stored role rather than the URL they arrived on. Two sign-in pages
 * that authenticated differently would only create a way to be wrong.
 */
export default async function AudienceSignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; audience: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale: rawLocale, audience: rawAudience } = await params;
  const locale = asLocale(rawLocale);
  const audience = parse(rawAudience);
  setRequestLocale(locale);

  // Validated here as everywhere else: this ends up in an href, and the rule
  // for what counts as internal lives in one place.
  const next = safeNext((await searchParams).next) ?? undefined;

  const { google: googleEnabled } = await enabledProviders();

  const t = await getTranslations('auth');

  return (
    <AuthShell audience={audience}>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold">
          {audience === 'employer' ? t('signInTitleEmployer') : t('signInTitle')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          {/* Carries `next` across. Somebody sent here by a "post a job" button
              who has no account yet was losing the wizard they were aimed at
              the moment they clicked through to sign up. */}
          <Link
            href={{ pathname: `/sign-up/${audience}`, query: next ? { next } : {} }}
            className="font-medium text-primary hover:underline"
          >
            {t('signUp')}
          </Link>
        </p>

        <ReturnIntent next={next} locale={locale} />

        <div className="mt-8">
          <AudienceSwitch mode="sign-in" active={audience} />
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
