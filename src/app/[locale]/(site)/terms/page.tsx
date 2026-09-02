import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor } from '@/i18n/routing';
import { LegalDocument } from '@/components/legal-document';
import { getLegalDoc } from '@/lib/legal';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const doc = getLegalDoc('terms', locale);
  return {
    title: doc?.title,
    robots: { index: true, follow: true },
    alternates: alternatesFor('/terms', locale),
  };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  return <LegalDocument doc={getLegalDoc('terms', locale)} locale={locale} />;
}
