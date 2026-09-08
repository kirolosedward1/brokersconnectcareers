import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { AuthShell } from '../../auth-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('forgotTitle'), robots: { index: false, follow: false } };
}

/**
 * A static segment, so it wins over /sign-in/[audience] — which would
 * otherwise treat "forgot" as an unknown audience and return a 404.
 */
export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <AuthShell>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold">{t('forgotTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('forgotBody')}</p>

        <div className="mt-8">
          <ForgotPasswordForm />
        </div>
      </div>
    </AuthShell>
  );
}
