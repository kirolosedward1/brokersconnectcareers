import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireProfile } from '@/lib/auth';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('hiddenTitle'), robots: { index: false, follow: false } };
}

/**
 * Hiding a listing, a company or a consultant is stored on the phone. There
 * is no server list to show, and this page does not invent one.
 */
export default async function HiddenPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireProfile(locale);
  const t = await getTranslations('account');

  return (
    <>
      <h1 className="text-xl font-bold">{t('hiddenTitle')}</h1>
      <p className="mt-4 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">{t('hiddenBody')}</p>
    </>
  );
}
