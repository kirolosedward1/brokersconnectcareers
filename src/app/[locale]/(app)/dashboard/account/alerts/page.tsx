import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { PushSettings } from '@/components/dashboard/push-settings';
import { requireProfile } from '@/lib/auth';
import { pushPreferencesOf } from '@/lib/push-preferences';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('notificationsTitle'), robots: { index: false, follow: false } };
}

/**
 * The bell is the notification list. These switches are what also reaches
 * the person's phones. When the columns are not on the profile yet, the
 * page says so and does not offer switches that could not be saved.
 */
export default async function AlertsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const viewer = await requireProfile(locale);
  const t = await getTranslations('account');
  const tNotifications = await getTranslations('notifications');
  const preferences = pushPreferencesOf(viewer.profile);

  return (
    <>
      <h1 className="text-xl font-bold">{t('notificationsTitle')}</h1>
      <div className="mt-8 space-y-8">
        {preferences ? (
          <PushSettings initial={preferences} employer={viewer.profile.role === 'employer'} />
        ) : (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">{t('pushUnavailable')}</p>
        )}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="font-semibold">
            <Link href="/notifications" className="underline-offset-4 hover:underline">
              {tNotifications('title')}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{tNotifications('lede')}</p>
        </section>
      </div>
    </>
  );
}
