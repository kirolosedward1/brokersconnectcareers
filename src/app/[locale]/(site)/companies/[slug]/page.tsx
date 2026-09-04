import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Globe, MapPin, Users } from 'lucide-react';
import { asLocale, alternatesFor, localized, routing, type Locale } from '@/i18n/routing';
import { VerifiedBadge } from '@/components/verified-badge';
import { CompanyLogo } from '@/components/companies/company-logo';
import { JobCard } from '@/components/jobs/job-card';
import { JsonLd } from '@/components/json-ld';
import { getCompanyBySlug } from '@/lib/queries/companies';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { truncate, toPlainText } from '@/lib/utils';
import type { JobListItem } from '@/lib/queries/jobs';

type Params = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const company = await getCompanyBySlug(slug);
  if (!company) return {};

  const name = localized(locale, company.name_ar, company.name_en);
  const about = localized(locale, company.about_ar, company.about_en);
  const path = `/companies/${slug}`;

  return {
    title: name,
    description: about ? truncate(toPlainText(about), 160) : undefined,
    alternates: alternatesFor(path, locale),
  };
}

export default async function CompanyPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from('jobs')
    .select(
      `
      *,
      company:companies!inner (id, name_ar, name_en, slug, logo_url, verification_status),
      district:districts!inner (id, governorate_id, name_ar, name_en, slug)
    `,
    )
    .eq('company_id', company.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('published_at', { ascending: false });

  const jobs = (data ?? []) as unknown as JobListItem[];

  const t = await getTranslations('companies');
  const tJobs = await getTranslations('jobs');

  const name = localized(locale, company.name_ar, company.name_en);
  const about = localized(locale, company.about_ar, company.about_en);

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name,
          url: `${env.siteUrl}/companies/${company.slug}`,
          ...(company.logo_url ? { logo: company.logo_url } : {}),
          ...(company.website ? { sameAs: [company.website] } : {}),
          ...(about ? { description: toPlainText(about) } : {}),
          address: {
            '@type': 'PostalAddress',
            addressCountry: 'EG',
            ...(company.district
              ? {
                  addressLocality: localized(
                    locale,
                    company.district.name_ar,
                    company.district.name_en,
                  ),
                }
              : {}),
          },
        }}
      />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="flex flex-wrap items-start gap-4">
          <CompanyLogo name={name} logoUrl={company.logo_url} seed={company.slug} size="lg" />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{name}</h1>
              <VerifiedBadge status={company.verification_status} label={t('verified')} />
            </div>

            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              {company.district ? (
                <div className="inline-flex items-center gap-1.5">
                  <dt className="sr-only">{t('location')}</dt>
                  <MapPin className="size-3.5" aria-hidden />
                  <dd>
                    {localized(locale, company.district.name_ar, company.district.name_en)}
                  </dd>
                </div>
              ) : null}

              {company.headcount_band ? (
                <div className="inline-flex items-center gap-1.5">
                  <dt className="sr-only">{t('headcount')}</dt>
                  <Users className="size-3.5" aria-hidden />
                  <dd className="numeral">
                    {t(`headcountBand.${company.headcount_band}`)}
                  </dd>
                </div>
              ) : null}

              {company.website ? (
                <div className="inline-flex items-center gap-1.5">
                  <dt className="sr-only">{t('website')}</dt>
                  <Globe className="size-3.5" aria-hidden />
                  <dd>
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      dir="ltr"
                      className="hover:text-foreground hover:underline"
                    >
                      {company.website.replace(/^https?:\/\//, '')}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </header>

        {about ? (
          <section className="mt-8" aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-lg font-semibold">
              {t('about')}
            </h2>
            <p className="mt-2 whitespace-pre-line leading-relaxed">{about}</p>
          </section>
        ) : null}

        <section className="mt-10" aria-labelledby="roles-heading">
          <h2 id="roles-heading" className="numeral text-lg font-semibold">
            {t('openRoles', { count: jobs.length })}
          </h2>

          {jobs.length ? (
            <ul className="mt-4 space-y-3">
              {jobs.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} locale={locale} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
              {tJobs('empty')}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
