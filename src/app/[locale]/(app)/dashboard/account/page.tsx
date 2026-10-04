import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { AccountSettings } from '@/components/dashboard/account-settings';
import { CredentialsSettings } from '@/components/dashboard/credentials-settings';
import { AvatarUpload } from '@/components/dashboard/avatar-upload';
import { safeNext } from '@/lib/safe-next';
import { MfaSettings } from '@/components/dashboard/mfa-settings';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * requireProfile rather than requireCandidate: an employer has the same rights
 * over their own data as anyone else, and this is where the privacy policy
 * says those rights are exercised.
 */
export default async function AccountPage({
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

  // Which identities the account actually has. A Google-only account has no
  // password to change, and offering the form anyway would let somebody set
  // one they can never use, since the sign-in button next to it does not ask.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hasPassword = (user?.identities ?? []).some((identity) => identity.provider === 'email');

  /*
    The second factor's state, read from the session. Allowed to fail quietly:
    an unreadable answer renders the section as "not set up", which offers
    enrolment — the safe direction — rather than hiding the section.
  */
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaLevel = assurance?.currentLevel === 'aal2' ? 'aal2' : 'aal1';
  const mfaEnrolled = assurance?.nextLevel === 'aal2';
  const mfaMode = mfa === 'required' ? 'required' : mfa === 'challenge' ? 'challenge' : null;
  const isAdmin = viewer.profile.role === 'admin';
  // Where the code was asked on the way to (the middleware's `next`), or the console.
  const afterVerify = safeNext(next ?? null) ?? (isAdmin ? '/admin' : '/dashboard/account');

  /*
    Signed in with the password alone on an account with an authenticator:
    the code, and nothing else of the account — not its address, its password
    or its settings — until it is answered (the middleware sends every
    account page here meanwhile).
  */
  if (mfaEnrolled && mfaLevel === 'aal1') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <div className="mt-8">
          <MfaSettings locale={locale} enrolled level="aal1" mode="challenge" afterVerify={afterVerify} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>

      <div className="mt-8 space-y-8">
        {/* First, because it is the one thing on this page that other people
            see. Everything below it is private. */}
        <AvatarUpload name={viewer.profile.full_name} avatarUrl={viewer.profile.avatar_url} />

        <CredentialsSettings email={viewer.email ?? ''} hasPassword={hasPassword} />

        <MfaSettings
          locale={locale}
          enrolled={mfaEnrolled}
          level={mfaLevel}
          mode={mfaMode}
          afterVerify={afterVerify}
        />

        <AccountSettings
          locale={locale}
          isEmployer={viewer.profile.role === 'employer'}
          initial={{
            notify_applications: viewer.profile.notify_applications,
            notify_status: viewer.profile.notify_status,
            notify_digest: viewer.profile.notify_digest,
            notify_applicant_digest: viewer.profile.notify_applicant_digest,
            notify_profile_nudge: viewer.profile.notify_profile_nudge,
          }}
        />
      </div>
    </div>
  );
}
