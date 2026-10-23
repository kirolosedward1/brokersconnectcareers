import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { CredentialsSettings } from '@/components/dashboard/credentials-settings';
import { MfaSettings } from '@/components/dashboard/mfa-settings';
import { requireProfile } from '@/lib/auth';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('securityTitle'), robots: { index: false, follow: false } };
}

/**
 * Password, email and the authenticator. An account that still owes a code
 * is sent to the account page by the middleware before this renders. Locking
 * the app is a phone setting; this page only says so.
 */
export default async function SecurityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mfa?: string; next?: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { mfa, next } = await searchParams;
  const viewer = await requireProfile(locale);
  const t = await getTranslations('account');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hasPassword = (user?.identities ?? []).some((identity) => identity.provider === 'email');
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaLevel = assurance?.currentLevel === 'aal2' ? 'aal2' : 'aal1';
  const mfaEnrolled = assurance?.nextLevel === 'aal2';
  const mfaMode = mfa === 'required' ? 'required' : mfa === 'challenge' ? 'challenge' : null;
  const afterVerify = safeNext(next ?? null) ?? '/dashboard/account/security';

  return (
    <>
      <h1 className="text-xl font-bold">{t('securityTitle')}</h1>
      <div className="mt-8 space-y-8">
        <CredentialsSettings email={viewer.email ?? ''} hasPassword={hasPassword} />
        <MfaSettings locale={locale} enrolled={mfaEnrolled} level={mfaLevel} mode={mfaMode} afterVerify={afterVerify} />
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">{t('appLockNote')}</p>
        <p>
          <Link href="/dashboard/account/delete" className="text-sm font-medium text-destructive underline-offset-4 hover:underline">
            {t('deleteTitle')}
          </Link>
        </p>
      </div>
    </>
  );
}
