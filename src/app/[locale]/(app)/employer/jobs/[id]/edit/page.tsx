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
import { UUID_RE } from '@/lib/admin/params';

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
  const viewer = await requireEmployer(locale);
  if (!viewer.company) notFound();

  const supabase = await createClient();

  /*
    Scoped to the caller's own company, not left to RLS.

    RLS lets everyone read a live, expired or closed listing — the public
    board needs that — so an employer with another company's listing id got
    its edit form, and an admin got anybody's. The save would have refused
    both, but a form for something that is not yours is a page that lies.
    Unreadable is still not absent: an error goes to the boundary, a
    listing that is not this company's is a 404.
  */
  // A truncated link is a page that does not exist, not a database error:
  // the id is compared with a uuid column, and the cast refused it.
  if (!UUID_RE.test(id)) notFound();
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('company_id', viewer.company.id)
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
        <h1 className="text-xl font-bold">{t('editJobTitle')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('editJobLede')}</p>
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
