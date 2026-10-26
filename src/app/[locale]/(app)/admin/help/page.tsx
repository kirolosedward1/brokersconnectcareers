import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HelpCenter } from '@/components/admin/help-center';
import { PageHeader } from '@/components/admin/kit';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth';
import { HELP_SUPPORT_EMAIL, localizeHelp } from '@/lib/admin/help/localize';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('help'), robots: { index: false, follow: false } };
}

/**
 * The console's own guide. Nothing here is loaded from the database: the
 * sentences are the product as it is built, and the page is only as open as
 * the rest of /admin.
 */
export default async function AdminHelpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const t = await getTranslations('admin');

  return (
    <div className="space-y-6">
      <PageHeader title={t('help')} lede={t('helpLede')} />
      <HelpCenter sections={localizeHelp(locale)} supportEmail={HELP_SUPPORT_EMAIL} />
    </div>
  );
}
