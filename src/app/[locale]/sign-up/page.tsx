import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, type Locale } from '@/i18n/routing';
import { AuthForm } from '@/components/auth/auth-form';
import { AuthShell } from '../auth-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signUp'), robots: { index: false, follow: false } };
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <AuthShell>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold">{t('signUpTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('haveAccount')}{' '}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            {t('signIn')}
          </Link>
        </p>

        <div className="mt-8">
          <Suspense>
            <AuthForm mode="sign-up" locale={locale} />
          </Suspense>
        </div>
      </div>
    </AuthShell>
  );
}
