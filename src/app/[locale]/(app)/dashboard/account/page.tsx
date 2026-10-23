import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Download } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { AccountSignOut } from '@/components/dashboard/account-sign-out';
import { AvatarUpload } from '@/components/dashboard/avatar-upload';
import { MfaSettings } from '@/components/dashboard/mfa-settings';
import { ThemeToggle } from '@/components/theme-toggle';
import { actorOf, requireProfile } from '@/lib/auth';
import { OPERATOR } from '@/lib/business';
import { configuredValue, env } from '@/lib/env';
import { safeNext } from '@/lib/safe-next';
import { canAccessCandidateArea, canAccessEmployerArea } from '@/lib/permissions';
import { raise } from '@/lib/queries/error';
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

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 items-center px-4 py-3 text-sm font-medium hover:bg-muted/50">
      {children}
    </Link>
  );
}

/**
 * requireProfile rather than requireCandidate: an employer has the same rights
 * over their own data as anyone else, and this is where the privacy policy
 * says those rights are exercised.
 *
 * The sections match the app's account screen. Signing in, the emails, the
 * pushes, deletion and the phone-only lists each have their own page. A copy
 * of the data stays a link, because the download is already an API route.
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
  const actor = actorOf(viewer);
  const t = await getTranslations('account');
  const tTheme = await getTranslations('theme');
  const tOnboarding = await getTranslations('onboarding');
  const tDashboard = await getTranslations('dashboard');
  const tEmployer = await getTranslations('employer');
  const tFooter = await getTranslations('footer');
  const tLicenses = await getTranslations('licenses');

  const supabase = await createClient();
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // A failed read is not "no authenticator". The page would otherwise open the
  // whole account to a session that still owes a code.
  if (assuranceError) raise(assuranceError, 'reading whether a code is still owed');
  const mfaLevel = assurance?.currentLevel === 'aal2' ? 'aal2' : 'aal1';
  const mfaEnrolled = assurance?.nextLevel === 'aal2';
  const mfaMode = mfa === 'required' ? 'required' : mfa === 'challenge' ? 'challenge' : null;
  const isAdmin = viewer.profile.role === 'admin';
  const afterVerify = safeNext(next ?? null) ?? (isAdmin ? '/admin' : '/dashboard/account');

  if (mfaEnrolled && mfaLevel === 'aal1') {
    const help = configuredValue(env.supportEmail) ?? OPERATOR.email;
    return (
      <>
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <div className="mt-8">
          <MfaSettings locale={locale} enrolled level="aal1" mode={isAdmin ? 'challenge' : null} afterVerify={afterVerify} />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {t.rich('mfaLost', {
            email: help,
            link: (chunks) => (
              <a href={`mailto:${help}`} dir="ltr" className="underline underline-offset-4 hover:text-foreground">
                {chunks}
              </a>
            ),
          })}
        </p>
      </>
    );
  }

  // The preview link only. Allowed to fail quietly: the directory page still says whether the card is there.
  const { data: card } = await supabase
    .from('agent_profiles')
    .select('slug')
    .eq('user_id', viewer.userId)
    .maybeSingle();
  const preview = typeof card?.slug === 'string' && card.slug ? card.slug : null;
  const help = configuredValue(env.supportEmail) ?? OPERATOR.email;

  return (
    <>
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>

      <div className="mt-8 space-y-8">
        {mfaMode === 'required' ? (
          <MfaSettings locale={locale} enrolled={mfaEnrolled} level={mfaLevel} mode="required" afterVerify={afterVerify} />
        ) : null}

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <AvatarUpload name={viewer.profile.full_name} avatarUrl={viewer.profile.avatar_url} />
          <div className="mt-4 space-y-1">
            {viewer.profile.full_name ? <p className="font-semibold">{viewer.profile.full_name}</p> : null}
            {viewer.email ? (
              <p className="text-sm text-muted-foreground" dir="ltr">
                {viewer.email}
              </p>
            ) : null}
            {viewer.profile.role === 'candidate' ? <p className="text-sm">{tOnboarding('roleKnownCandidate')}</p> : null}
            {viewer.profile.role === 'employer' ? <p className="text-sm">{tOnboarding('roleKnownEmployer')}</p> : null}
            {viewer.company ? (
              <p className="text-sm font-medium">{localized(locale, viewer.company.name_ar, viewer.company.name_en)}</p>
            ) : null}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{tTheme('label')}</h2>
          <ThemeToggle />
        </section>

        <nav className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <ul className="divide-y divide-border">
            {canAccessCandidateArea(actor) ? (
              <li>
                <Row href="/dashboard/profile">{tDashboard('profile')}</Row>
              </li>
            ) : null}
            {preview ? (
              <li>
                <Row href={`/agents/${preview}`}>{t('previewProfile')}</Row>
              </li>
            ) : null}
            {canAccessEmployerArea(actor) ? (
              <>
                <li>
                  <Row href="/employer/company">{tEmployer('company')}</Row>
                </li>
                <li>
                  <Row href="/employer/billing">{tEmployer('billing')}</Row>
                </li>
              </>
            ) : null}
            <li>
              <Row href="/dashboard/account/security">{t('securityTitle')}</Row>
            </li>
            <li>
              <Row href="/dashboard/account/alerts">{t('notificationsTitle')}</Row>
            </li>
            <li>
              <Row href="/dashboard/account/emails">{t('messagesTitle')}</Row>
            </li>
            <li>
              <AccountSignOut locale={locale as Locale} />
            </li>
          </ul>
        </nav>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="font-semibold">{t('exportTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('exportBody')}</p>
          <a
            href="/api/account/export"
            download
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted/50"
          >
            <Download className="size-4" aria-hidden />
            {t('exportCta')}
          </a>
        </section>

        <nav className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <ul className="divide-y divide-border">
            <li>
              <Row href="/dashboard/account/hidden">{t('hiddenTitle')}</Row>
            </li>
          </ul>
        </nav>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{tFooter('about')}</h2>
          <nav className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <ul className="divide-y divide-border">
              <li>
                <Row href="/privacy">{tFooter('privacy')}</Row>
              </li>
              <li>
                <Row href="/terms">{tFooter('terms')}</Row>
              </li>
              <li>
                <Row href="/licenses">{tLicenses('title')}</Row>
              </li>
              <li>
                <a
                  href={`mailto:${help}`}
                  className="flex min-h-11 items-center px-4 py-3 text-sm font-medium hover:bg-muted/50"
                >
                  {tFooter('contact')}
                </a>
              </li>
            </ul>
          </nav>
        </section>
      </div>
    </>
  );
}
