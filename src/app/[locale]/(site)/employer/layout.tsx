import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { SectionNav } from '@/components/section-nav';
import { requireEmployer } from '@/lib/auth';

export default async function EmployerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireEmployer(locale);

  const t = await getTranslations('employer');
  const tNav = await getTranslations('nav');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{tNav('employerArea')}</h1>
      <SectionNav
        items={[
          { href: '/employer/jobs', label: t('jobs') },
          { href: '/employer/company', label: t('company') },
          { href: '/employer/billing', label: t('billing') },
        ]}
      />
      {children}
    </div>
  );
}
