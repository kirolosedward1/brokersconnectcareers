import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { AccountSettings } from '@/components/dashboard/account-settings';
import { requireProfile } from '@/lib/auth';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('deleteTitle'), robots: { index: false, follow: false } };
}

export default async function DeleteAccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const viewer = await requireProfile(locale);
  const t = await getTranslations('account');

  return (
    <>
      <h1 className="text-xl font-bold">{t('deleteTitle')}</h1>
      <div className="mt-8">
        <AccountSettings
          locale={locale}
          part="delete"
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
    </>
  );
}
