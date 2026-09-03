import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect, Link } from '@/i18n/navigation';
import { asLocale, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { JobForm } from '@/components/employer/job-form';
import { requireEmployer } from '@/lib/auth';
import { getDistricts, getDevelopers } from '@/lib/queries/taxonomy';

export default async function NewJobPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const t = await getTranslations('employer');

  if (!viewer.company) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="font-medium">{t('createCompanyFirst')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('createCompanyFirstBody')}</p>
        <Button asChild className="mt-5">
          <Link href="/employer/company">{t('company')}</Link>
        </Button>
      </div>
    );
  }

  const [districts, developers] = await Promise.all([getDistricts(), getDevelopers()]);

  return (
    <JobForm
      locale={locale}
      job={null}
      districts={districts}
      developers={developers}
      selectedDeveloperIds={[]}
    />
  );
}
