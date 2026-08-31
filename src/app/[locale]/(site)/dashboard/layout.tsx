import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, type Locale } from '@/i18n/routing';
import { SectionNav } from '@/components/section-nav';
import { requireCandidate } from '@/lib/auth';

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  // Bounces an unauthenticated visitor to sign-in and an employer to their own
  // area, so every page below can assume a candidate profile exists.
  await requireCandidate(locale);

  const t = await getTranslations('dashboard');

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      <SectionNav
        items={[
          { href: '/dashboard/applications', label: t('applications') },
          { href: '/dashboard/saved', label: t('saved') },
          { href: '/dashboard/profile', label: t('profile') },
        ]}
      />
      {children}
    </div>
  );
}
