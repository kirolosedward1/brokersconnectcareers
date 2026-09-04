import { setRequestLocale } from 'next-intl/server';
import { asLocale, type Locale } from '@/i18n/routing';
import { Landing } from '@/components/home/landing';
import { SignedInHome } from '@/components/home/signed-in-home';
import { getViewer } from '@/lib/auth';
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

  const { jobs, total } = await optional(queryJobs({ ...EMPTY_FILTERS }), {
    jobs: [],
    total: 0,
    pageCount: 0,
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
