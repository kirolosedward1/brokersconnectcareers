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
import { getCompanyBySlug, getCompanyOpenJobs } from '@/lib/queries/companies';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/lib/auth';
import { followQuery } from '@/lib/saved-search';
import { env } from '@/lib/env';
import { truncate, toPlainText } from '@/lib/utils';

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

  /*
    Indexable while the company is hiring, and only then.

    Every company row is publicly readable — that is how a listing names its
    employer — but a row is not a page worth a search result. An account
    that signed up and never had a listing approved, a brokerage whose last
    role closed in the spring, a company whose roles came down with a
    suspension: each renders a name and "no open roles". The directory
    already hides them (it lists only companies with a live listing) and the
    sitemap now does the same, so the page agrees. It stays reachable for
    anybody following a link, and returns to the index the day it hires.
  */
  const hiring = (await getCompanyOpenJobs(company.id)).length > 0;

  return {
    title: name,
    description: about ? truncate(toPlainText(about), 160) : undefined,
    ...(hiring
      ? { alternates: alternatesFor(path, locale) }
      : { robots: { index: false, follow: true } }),
  };
}

export default async function CompanyPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  const jobs = await getCompanyOpenJobs(company.id);
  const supabase = await createClient();

  const viewer = await getViewer();

  /*
    Who is offered the follow.

    Candidates, and readers who are not signed in — the button points those at
    sign-in with a `next` back here, and hiding it would mean only people who
    already have an account ever discover it.

    Not employers. Following writes a saved search, and a saved search is a
    candidate's row: the digest it feeds is worded for somebody looking for
    work, and /dashboard/saved, the one page that lists it, turns employers
    away. An employer who pressed this got a follow they could undo only by
    finding this page again and mail they had no switch for. That covers the
    company's own people as a special case of the rule rather than as one of
    its own — being told weekly about listings you posted yourself was never a
    feature either.
  */
  const offerFollow = !viewer || viewer.profile?.role === 'candidate';

  /*
    Whether this reader already follows the company.

    One row lookup, and only for somebody who could act on the answer — there
    is none to give a visitor, and the page is otherwise public and cacheable.
    Row-level security scopes saved_searches to its owner, so no candidate_id
    is written here, for the same reason it is not written on the inbox.
  */
  let following = false;

  if (viewer && offerFollow) {
    // Allowed to fail quietly: the button falls back to "follow", and
    // pressing it lands on the unique constraint and reports success, because
    // already following is the outcome it was asked for.
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
          {offerFollow ? (
            <FollowCompanyButton
              slug={company.slug}
              label={name}
              initialFollowing={following}
              signedIn={Boolean(viewer)}
              className="basis-full sm:basis-auto"
            />
          ) : null}
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
            <p className="mt-4 rounded-xl border border-dashed border-border px-6 py-8 text-center text-muted-foreground">
              {tJobs('empty')}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
