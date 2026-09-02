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
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * requireProfile rather than requireCandidate: an employer has the same rights
 * over their own data as anyone else, and this is where the privacy policy
 * says those rights are exercised.
 */
export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const viewer = await requireProfile(locale);
  const t = await getTranslations('account');

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>

      <div className="mt-8">
        <AccountSettings
          locale={locale}
          isEmployer={viewer.profile.role === 'employer'}
          initial={{
            notify_applications: viewer.profile.notify_applications,
            notify_status: viewer.profile.notify_status,
            notify_digest: viewer.profile.notify_digest,
          }}
        />
      </div>
    </div>
  );
}
