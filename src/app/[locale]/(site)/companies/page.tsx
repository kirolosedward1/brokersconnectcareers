import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Building2, MapPin } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { alternatesFor, localized, type Locale } from '@/i18n/routing';
import { VerifiedBadge } from '@/components/verified-badge';
import { Pagination } from '@/components/pagination';
import { queryCompanies } from '@/lib/queries/companies';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
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
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { q, page } = await searchParams;
  const current = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const { companies, pageCount } = await queryCompanies({ q, page: current });

  const t = await getTranslations('companies');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      {companies.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((company) => {
            const openRoles = company.open_roles?.[0]?.count ?? 0;
            return (
              <li key={company.id}>
                <Link
                  href={`/companies/${company.slug}`}
                  className="block h-full rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"
                    >
                      <Building2 className="size-5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {localized(locale, company.name_ar, company.name_en)}
                      </p>
                      {company.district ? (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="size-3.5" aria-hidden />
                          {localized(
                            locale,
                            company.district.name_ar,
                            company.district.name_en,
                          )}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <VerifiedBadge
                      status={company.verification_status}
                      label={t('verified')}
                    />
                    <span className="numeral text-sm text-muted-foreground">
                      {t('openRoles', { count: openRoles })}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={current}
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
