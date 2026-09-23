import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Briefcase, MapPin } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, alternatesFor, localized, type Locale } from '@/i18n/routing';
import { VerifiedBadge } from '@/components/verified-badge';
import { Pagination } from '@/components/pagination';
import { CompanyFilters } from '@/components/companies/company-filters';
import { CompanyLogo } from '@/components/companies/company-logo';
import { queryCompanies } from '@/lib/queries/companies';
import { getDistricts } from '@/lib/queries/taxonomy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'companies' });
  return {
    title: t('title'),
    alternates: alternatesFor('/companies', locale),
  };
}

export default async function CompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; district?: string; verified?: string; page?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const { q, district, verified, page } = await searchParams;
  const current = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);

  const districts = await getDistricts();
  // The URL carries a slug because that is what a person can read and share;
  // the query wants the id.
  const districtId = district ? districts.find((item) => item.slug === district)?.id : undefined;

  // `served`, because `page` is already taken by the raw search parameter
  // above — and the two are deliberately different numbers.
  const { companies, pageCount, page: served } = await queryCompanies({
    q,
    districtId,
    verifiedOnly: verified === '1',
    page: current,
  });

  const t = await getTranslations('companies');

  return (
    <div className="shell py-6">
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('lede')}</p>

      <CompanyFilters
        locale={locale}
        districts={districts}
        action={locale === 'ar' ? '/companies' : `/${locale}/companies`}
      />

      {companies.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border px-6 py-10 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        /* Columns, because a company row is short: a mark, a name, a district
           and one figure. One to a line, each stretched the width of the page
           with a name at one end, a number at the other and a metre of card
           between them — five companies to a laptop screen. Three across, the
           same screen holds fifteen. */
        <ul className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => {
            const openRoles = company.open_roles?.[0]?.count ?? 0;
            return (
              <li key={company.id}>
                <Link
                  href={`/companies/${company.slug}`}
                  className="lift flex h-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <CompanyLogo
                    name={localized(locale, company.name_ar, company.name_en)}
                    logoUrl={company.logo_url}
                    seed={company.slug}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <bdi className="truncate">
                        {localized(locale, company.name_ar, company.name_en)}
                      </bdi>
                      <VerifiedBadge
                        compact
                        status={company.verification_status}
                        label={t('verified')}
                      />
                    </p>

                    {company.district ? (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="size-3.5" aria-hidden />
                        {localized(locale, company.district.name_ar, company.district.name_en)}
                      </p>
                    ) : null}
                  </div>

                  {/* The open-role count is why someone opens a company page, so
                      it sits at the end of the row where the eye lands last.
                      A briefcase and a numeral, not a sentence: down a list of
                      companies this column is scanned, not read, and the full
                      phrase wrapped to two lines on a phone. The sentence is
                      still there for screen readers, which do have to read it. */}
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary"
                    title={t('openRoles', { count: openRoles })}
                  >
                    <Briefcase className="size-4" aria-hidden />
                    <span className="numeral" aria-hidden>
                      {openRoles}
                    </span>
                    <span className="sr-only">{t('openRoles', { count: openRoles })}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* `served`, not `current`: a request past the end is answered with the
          last page, and the footer has to name the page that was served. */}
      <Pagination
        page={served}
        pageCount={pageCount}
        buildHref={(next) => {
          const search = new URLSearchParams();
          if (q) search.set('q', q);
          if (next > 1) search.set('page', String(next));
          const query = search.toString();
          return query ? `/companies?${query}` : '/companies';
        }}
      />
    </div>
  );
}
