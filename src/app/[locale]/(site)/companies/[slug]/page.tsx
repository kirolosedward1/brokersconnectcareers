import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Globe, MapPin, Users } from 'lucide-react';
import { asLocale, alternatesFor, localized, routing, type Locale } from '@/i18n/routing';
import { VerifiedBadge } from '@/components/verified-badge';
import { CompanyLogo } from '@/components/companies/company-logo';
import { FollowCompanyButton } from '@/components/companies/follow-company-button';
import { JobCard } from '@/components/jobs/job-card';
import { JsonLd } from '@/components/json-ld';
import { getCompanyBySlug } from '@/lib/queries/companies';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/lib/auth';
import { followQuery } from '@/lib/saved-search';
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
  // notFound() here rather than returning empty metadata, so a missing record
  // takes one path instead of rendering a page with no title and then failing
  // in the body.
  //
  // It does NOT make the status a 404, and I tried: this route streams, so the
  // headers are gone before either check runs and Next can only serve the
  // not-found UI under a 200. Metadata streams with it, so moving the check
  // earlier changes nothing. The only way to a real 404 here is to delete
  // loading.tsx and give up the skeleton on the three page types that most
  // need one, which is a worse trade than a soft 404 that carries
  // `robots: noindex` — Google never indexes these, and what is left is a
  // Search Console warning rather than a penalty. /blog returns a true 404
  // only because it has no loading.tsx and therefore does not stream.
  if (!company) notFound();

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

  /*
    Whether this reader already follows the company.

    One row lookup, and only for somebody signed in — there is no answer to
    give a visitor, and the page is otherwise public and cacheable. Row-level
    security scopes saved_searches to its owner, so no candidate_id is written
    here, for the same reason it is not written on the inbox.

    Hidden from the company's own people: being told weekly about listings you
    posted yourself is not a feature.
  */
  const viewer = await getViewer();
  const ownHouse = viewer?.company?.id === company.id;
  let following = false;

  if (viewer && !ownHouse) {
    const { data: follow } = await supabase
      .from('saved_searches')
      .select('id')
      .eq('query', followQuery(company.slug))
      .maybeSingle();
    following = Boolean(follow);
  }

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
                  <dd>
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

          {/*
            Its own row on a phone.

            The header wraps, but the name column is `flex-1` — so on a 375px
            screen it shrank instead of the button wrapping, and "نايل بروكرز"
            broke across two lines to make room for a control beside it.
            `basis-full` makes the button claim a line of its own at that width
            and sit back beside the name from `sm` up.
          */}
          {ownHouse ? null : (
            <FollowCompanyButton
              slug={company.slug}
              label={name}
              initialFollowing={following}
              signedIn={Boolean(viewer)}
              className="basis-full sm:basis-auto"
            />
          )}
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
          <h2 id="roles-heading" className="text-lg font-semibold">
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
