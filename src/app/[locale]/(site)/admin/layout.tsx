import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { SectionNav } from '@/components/section-nav';
import { requireAdmin } from '@/lib/auth';

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdmin(locale);
  const t = await getTranslations('admin');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      <SectionNav
        items={[
          { href: '/admin/jobs', label: t('jobsQueue') },
          { href: '/admin/companies', label: t('companiesQueue') },
          { href: '/admin/reports', label: t('reports') },
        ]}
      />
      {children}
    </div>
  );
}
