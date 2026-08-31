import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, type Locale } from '@/i18n/routing';
import { LegalPlaceholder } from '@/components/legal-placeholder';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'footer' });
  return { title: t('terms'), robots: { index: false, follow: true } };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations('footer');

  return <LegalPlaceholder title={t('terms')} />;
}
