import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, type Locale } from '@/i18n/routing';
import { JobForm } from '@/components/employer/job-form';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { getDistricts, getDevelopers } from '@/lib/queries/taxonomy';
import type { JobRow } from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'employer' });
  return { title: t('editJobTitle'), robots: { index: false, follow: false } };
}

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireEmployer(locale);

  const supabase = await createClient();

  // RLS scopes this to jobs the caller's company owns, so a wrong id is simply
  // not found rather than forbidden.
  // Unreadable is not absent: both arrived as null and both became a 404, so
  // a blip told an employer their own listing was gone rather than that
  // something had failed. The same distinction the applicants page now makes.
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (jobError) raise(jobError, 'loading the listing to edit');
  if (!job) notFound();

  // Allowed to fail quietly, for the same reason the profile's developer
  // chips are: an unticked box in one field, which the next save corrects.
  const { data: jobDevelopers } = await supabase
    .from('job_developers')
    .select('developer_id')
    .eq('job_id', id);

  const [districts, developers] = await Promise.all([getDistricts(), getDevelopers()]);

  const t = await getTranslations('employer');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('editJobTitle')}</h1>
        <p className="mt-1 text-muted-foreground">{t('editJobLede')}</p>
      </header>

      <JobForm
        locale={locale}
        job={job as JobRow}
        districts={districts}
        developers={developers}
        selectedDeveloperIds={(jobDevelopers ?? []).map((row) => row.developer_id)}
      />
    </div>
  );
}
