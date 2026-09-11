import { setRequestLocale } from 'next-intl/server';
import { asLocale, type Locale } from '@/i18n/routing';
import { Landing } from '@/components/home/landing';
import { EmployerHome, type EmployerSummary } from '@/components/home/employer-home';
import { SignedInHome } from '@/components/home/signed-in-home';
import { getViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDistricts } from '@/lib/queries/taxonomy';
import { EMPTY_FILTERS, queryJobs } from '@/lib/queries/jobs';
import { optional } from '@/lib/queries/error';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const viewer = await getViewer();

  // The landing page's job is to explain the product, so it must survive the
  // database being unreachable — every read here is allowed to come back empty.
  const districts = await optional(getDistricts(), []);

  if (!viewer?.profile) {
    return <Landing locale={locale} districts={districts} />;
  }

  // Somebody who hires does not get a feed of other companies' listings. They
  // get their own: who is waiting, what is live, what is stuck in review, what
  // expires this week. Fetched instead of the job list, not alongside it — the
  // board query is real work and nothing on their page uses it.
  if (viewer.profile.role === 'employer' || viewer.profile.role === 'admin') {
    const supabase = await createClient();
    // The home page must survive the database being unreachable, the same way
    // the landing page does — an empty summary renders the "no company yet"
    // state rather than a 500.
    const summary = await optional(
      supabase.rpc('employer_summary').then(({ data }) => data as EmployerSummary | null),
      null,
    );

    return (
      <EmployerHome
        locale={locale}
        name={viewer.profile.full_name}
        summary={summary}
        approvalStatus={viewer.profile.approval_status}
      />
    );
  }

  const { jobs, total } = await optional(queryJobs({ ...EMPTY_FILTERS }), {
    jobs: [],
    total: 0,
    pageCount: 0,
    page: 1,
  });

  return (
    <SignedInHome
      locale={locale}
      name={viewer.profile.full_name}
      role={viewer.profile.role}
      districts={districts}
      jobs={jobs}
      total={total}
    />
  );
}
