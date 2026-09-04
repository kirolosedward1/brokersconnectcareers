import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { asLocale, type Locale } from '@/i18n/routing';
import { getViewer } from '@/lib/auth';
import { getDistricts } from '@/lib/queries/taxonomy';
import { optional } from '@/lib/queries/error';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import { AuthShell } from '../auth-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'onboarding' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; role?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const viewer = await getViewer();
  if (!viewer) redirect({ href: '/sign-in', locale });

  // Already onboarded — nothing to ask.
  if (viewer!.profile) {
    redirect({
      href: viewer!.profile.role === 'employer' ? '/employer/jobs' : '/dashboard/applications',
      locale,
    });
  }

  const { next, role } = await searchParams;

  // Pre-selected, not decided. The account type cannot be changed once the
  // profile exists, and a permanent choice should not be made by a URL the
  // person may never have read — so the question still appears, already
  // answered, and they can change it.
  const defaultRole = role === 'employer' || role === 'candidate' ? role : undefined;
  const t = await getTranslations('onboarding');

  // Needed only for the company block, but fetched unconditionally: the role
  // is chosen in the browser, so the server cannot know which form is coming.
  const districts = await optional(getDistricts(), []);

  return (
    <AuthShell>
        <div className="mx-auto w-full max-w-lg px-4">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
        <div className="mt-8">
          <OnboardingForm
            locale={locale}
            defaultName={viewer!.suggestedName}
            defaultRole={defaultRole}
            districts={districts}
            next={next && next.startsWith('/') ? next : undefined}
          />
        </div>
      </div>
    </AuthShell>
  );
}
