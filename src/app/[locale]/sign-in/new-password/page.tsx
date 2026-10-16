import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { NewPasswordForm } from '@/components/auth/new-password-form';
import { createClient } from '@/lib/supabase/server';
import { secondFactorChallenge } from '@/lib/auth/second-factor';
import { AuthShell } from '../../auth-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('newPasswordTitle'), robots: { index: false, follow: false } };
}

/**
 * Where a recovery link lands, after /auth/callback has exchanged its code.
 *
 * Gated on a session rather than left open: without one there is nothing to
 * update, and a bare password form with no account attached is a confusing
 * thing to arrive at. The two ways to get here without a session are a link
 * that has expired and a link that has already been used, and both want the
 * same answer — ask for another one.
 *
 * Deliberately not in the middleware's PROTECTED list. Those redirect to
 * /sign-in, which is precisely where somebody who cannot sign in should not be
 * sent back to.
 */
export default async function NewPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
    An account with an authenticator: the code before the form.

    A reset link proves the inbox and nothing more, so its session is aal1,
    and GoTrue refuses a password change at aal1 on an account that could
    prove aal2 (insufficient_aal). The form used to be drawn anyway, and its
    refusal read as "that link has expired" — every link, forever, for every
    account that had turned the second factor on. The account page asks for
    the code and comes back here once it is answered.
  */
  if (user) {
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance?.currentLevel === 'aal1' && assurance.nextLevel === 'aal2') {
      redirect({ href: secondFactorChallenge('/sign-in/new-password', '')!, locale });
    }
  }

  return (
    <AuthShell>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold">{t('newPasswordTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {user ? t('newPasswordBody') : t('linkExpired')}
        </p>

        <div className="mt-8">
          {user ? (
            <NewPasswordForm locale={locale} />
          ) : (
            <Button asChild className="w-full">
              <Link href="/sign-in/forgot">{t('sendResetLink')}</Link>
            </Button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
