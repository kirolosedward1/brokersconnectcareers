import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { AuthForm } from '@/components/auth/auth-form';
import { AuthShell, type Audience } from '../../auth-shell';

const AUDIENCES = ['candidate', 'employer'] as const;

function parse(value: string): Audience {
  if (!(AUDIENCES as readonly string[]).includes(value)) notFound();
  return value as Audience;
}

export function generateStaticParams() {
  return AUDIENCES.map((audience) => ({ audience }));
}

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
}: {
  params: Promise<{ locale: string; audience: string }>;
}) {
  const { locale: rawLocale, audience: rawAudience } = await params;
  const locale = asLocale(rawLocale);
  const audience = parse(rawAudience);
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <AuthShell audience={audience}>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold">
          {audience === 'employer' ? t('signInTitleEmployer') : t('signInTitle')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          <Link href={`/sign-up/${audience}`} className="font-medium text-primary hover:underline">
            {t('signUp')}
          </Link>
        </p>

        <div className="mt-8">
          <Suspense>
            <AuthForm mode="sign-in" locale={locale} />
          </Suspense>
        </div>
      </div>
    </AuthShell>
  );
}
