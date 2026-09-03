import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { asLocale, type Locale } from '@/i18n/routing';
import { JobForm } from '@/components/employer/job-form';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDistricts, getDevelopers } from '@/lib/queries/taxonomy';
import type { JobRow } from '@/lib/supabase/database.types';

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
  const { data: job } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
  if (!job) notFound();

  const { data: jobDevelopers } = await supabase
    .from('job_developers')
    .select('developer_id')
    .eq('job_id', id);

  const [districts, developers] = await Promise.all([getDistricts(), getDevelopers()]);

  return (
    <JobForm
      locale={locale}
      job={job as JobRow}
      districts={districts}
      developers={developers}
      selectedDeveloperIds={(jobDevelopers ?? []).map((row) => row.developer_id)}
    />
  );
}
