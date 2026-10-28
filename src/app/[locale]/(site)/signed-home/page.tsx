import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Landing } from '@/components/home/landing';
import { EmployerHome, type EmployerSummary } from '@/components/home/employer-home';
import { SignedInHome } from '@/components/home/signed-in-home';
import { actorOf, getViewer } from '@/lib/auth';
import { canAccessEmployerArea, homeFor } from '@/lib/permissions';
import { redirect } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getDistricts } from '@/lib/queries/taxonomy';
import { anonymousJobs, EMPTY_FILTERS, HOME_LATEST_JOBS, queryJobs } from '@/lib/queries/jobs';
import { optional } from '@/lib/queries/error';
import { getBrowseCounts } from '@/lib/queries/browse';

/**
 * The signed-in home, drawn by a rewrite of `/`.
 *
 * Not a URL to share or index. Middleware sends an anonymous request back to
 * `/`, and robots.txt keeps a crawler out. Dynamic because it reads the
 * session; the public landing stays cached.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'meta' });
  return { title: { absolute: t('jobsTitle') }, robots: { index: false, follow: false } };
}

export default async function SignedHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const [viewer, districts] = await Promise.all([getViewer(), optional(getDistricts(), [])]);
  // redirect() ends the request. The return is what the type checker sees,
  // because this call is not narrowed on its own in this file.
  if (!viewer) {
    redirect({ href: '/', locale });
    return null;
  }

  if (!viewer.profile) {
    const [counts, latest] = await Promise.all([
      optional(getBrowseCounts(), null),
      optional(queryJobs({ ...EMPTY_FILTERS }, anonymousJobs(), { limit: HOME_LATEST_JOBS }), {
        jobs: [],
        total: 0,
        pageCount: 0,
        page: 1,
      }),
    ]);
    return <Landing locale={locale} districts={districts} counts={counts} jobs={latest.jobs} />;
  }

  if (viewer.profile.role === 'employer' || viewer.profile.role === 'admin') {
    const actor = actorOf(viewer);
    if (!canAccessEmployerArea(actor)) redirect({ href: homeFor(actor), locale });

    const supabase = await createClient();
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

  const [{ jobs, total }, counts] = await Promise.all([
    optional(queryJobs({ ...EMPTY_FILTERS }, anonymousJobs()), {
      jobs: [],
      total: 0,
      pageCount: 0,
      page: 1,
    }),
    optional(getBrowseCounts(), null),
  ]);

  return (
    <SignedInHome
      locale={locale}
      name={viewer.profile.full_name}
      role={viewer.profile.role}
      districts={districts}
      jobs={jobs}
      total={total}
      counts={counts}
    />
  );
}
