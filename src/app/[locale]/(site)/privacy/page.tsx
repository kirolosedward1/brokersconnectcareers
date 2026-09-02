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
  const doc = getLegalDoc('privacy', locale);
  return {
    title: doc?.title,
    // Indexable, unlike the placeholder that stood here. A real privacy policy
    // is a trust signal search engines look for from a business handling CVs.
    robots: { index: true, follow: true },
    alternates: alternatesFor('/privacy', locale),
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  return <LegalDocument doc={getLegalDoc('privacy', locale)} locale={locale} />;
}
