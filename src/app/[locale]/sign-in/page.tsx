import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { AuthForm } from '@/components/auth/auth-form';
import { AuthShell } from '../auth-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signIn'), robots: { index: false, follow: false } };
}

export default async function SignInPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <AuthShell>
        <div className="mx-auto w-full max-w-sm px-4">
        <h1 className="text-2xl font-bold">{t('signInTitle')}</h1>
        <div className="mt-6">
          <Suspense>
            <AuthForm mode="sign-in" locale={locale} />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            {t('signUp')}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
