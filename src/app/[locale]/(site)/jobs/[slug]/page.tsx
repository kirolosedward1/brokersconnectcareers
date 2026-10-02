import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor, localized, routing, type Locale } from '@/i18n/routing';
import { JobDetailView } from '@/components/jobs/job-detail-view';
import { TrackDistrictLanding } from '@/components/jobs/track-district-landing';
import { JsonLd } from '@/components/json-ld';
import { jobPostingJsonLd } from '@/lib/seo/job-posting';
import { jobIsLive, jobIsPublic } from '@/lib/job-state';
import { EMPTY_FILTERS, getJobBySlug, queryJobs } from '@/lib/queries/jobs';
import { buildLandingSlug, parseLandingSlug } from '@/lib/taxonomy';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumbs';
import { getDistrictBySlug, getGovernorates } from '@/lib/queries/taxonomy';
import { recordJobView } from '@/lib/actions/jobs';
import { formatEgp, truncate, toPlainText } from '@/lib/utils';
import type { DistrictRow, JobStatus, JobTrack } from '@/lib/supabase/database.types';
import type { JobDetail } from '@/lib/queries/jobs';

type Params = { locale: string; slug: string };

/**
 * `/jobs/[slug]` serves two things: a job, and a programmatic
 * `<track>-<district>` landing page. Landing slugs are drawn from a closed
 * taxonomy, and every job slug carries a random suffix, so the two can never
 * collide — the landing form is checked first because it is a pure string
 * match with no database round trip.
 */
/**
 * Open means open, not merely marked open.
 *
 * `status` is flipped to 'expired' by the nightly cron, so a listing whose
 * expires_at passed an hour ago still says 'active'. Everything that decides
 * whether this listing is live — the markup, the banner, the view counter, the
 * robots directive — has to agree, and they did not.
 */
const isOpen = jobIsLive;

type Resolved =
  | { kind: 'landing'; track: JobTrack; district: DistrictRow }
  | { kind: 'job'; job: JobDetail }
  | { kind: 'none' };

async function resolve(slug: string): Promise<Resolved> {
  const landing = parseLandingSlug(slug);
  if (landing) {
    const district = await getDistrictBySlug(landing.districtSlug);
    if (district) return { kind: 'landing', track: landing.track, district };
  }

  const job = await getJobBySlug(slug);
  if (job) return { kind: 'job', job };

  return { kind: 'none' };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const resolved = await resolve(slug);

  if (resolved.kind === 'landing') {
    const t = await getTranslations({ locale, namespace: 'landing' });
    const tTrack = await getTranslations({ locale, namespace: 'track' });
    const track = tTrack(resolved.track);
    const district = localized(locale, resolved.district.name_ar, resolved.district.name_en);

    /*
      An empty cross-product page is thin content, and there are 126 of these
      against twelve that have a listing. They stay reachable and internally
      linked — a district with nothing today has something next week, and the
      sibling links are what spread crawl budget — but a page showing no
      results should not be inviting Google to index it. The sitemap makes the
      same distinction.

      queryJobs is request-cached, so this costs no extra round trip: the page
      body runs the identical query a moment later and gets the same result.
    */
    const { total } = await queryJobs({
      ...EMPTY_FILTERS,
      tracks: [resolved.track],
      districtSlugs: [resolved.district.slug],
    });

    return {
      title: t('title', { track, district }),
      description: t('subtitle', { track, district }),
      ...(total === 0
        ? { robots: { index: false, follow: true } }
        : { alternates: alternatesFor(`/jobs/${slug}`, locale) }),
    };
  }

  if (resolved.kind === 'job') {
    const job = resolved.job;
    const title = localized(locale, job.title_ar, job.title_en);
    const company = localized(locale, job.company.name_ar, job.company.name_en);
    const district = localized(locale, job.district.name_ar, job.district.name_en);
    /**
     * The pay leads the preview, not the prose.
     *
     * This site exists on the claim that a listing states the salary, the
     * commission source and the district before anybody applies — and a link
     * shared on WhatsApp was previewing the first 160 characters of the job
     * description, which is the one part of a listing that reads like every
     * other listing. The facts go first; the prose fills what is left.
     */
    const tComp = await getTranslations({ locale, namespace: 'compensation' });
    const tLeads = await getTranslations({ locale, namespace: 'leadsSource' });
    // The currency word on its own. The salary messages carry it inline, but
    // those hold rich tags for the digits and cannot be read as plain strings.
    const tCommon = await getTranslations({ locale, namespace: 'common' });

    // The card's own cases (SalaryLine): a range, "from", "up to" — which
    // this used to call "commission only" — or no salary at all.
    const money =
      job.basic_salary_min != null && job.basic_salary_max != null
        ? `${formatEgp(job.basic_salary_min, locale)} – ${formatEgp(job.basic_salary_max, locale)} ${tCommon('egp')} ${tComp('perMonth')}`
        : job.basic_salary_min != null
          ? `${formatEgp(job.basic_salary_min, locale)}+ ${tCommon('egp')} ${tComp('perMonth')}`
          : job.basic_salary_max != null
            ? `${tComp('upTo')} ${formatEgp(job.basic_salary_max, locale)} ${tCommon('egp')} ${tComp('perMonth')}`
            : tComp(job.commission_type === 'none' ? 'noBasicSalary' : 'commissionOnly');

    const facts = [money, tLeads(`${job.leads_source}_short`), district].join(' · ');
    const prose = toPlainText(localized(locale, job.description_ar, job.description_en));
    const description = truncate(`${facts} — ${prose}`, 200);

    return {
      title: `${title} — ${company} — ${district}`,
      description,
      alternates: alternatesFor(`/jobs/${slug}`, locale),
      openGraph: { title: `${title} — ${company}`, description, type: 'article' },
      // An expired listing must not be indexed as if it were open.
      //
      // isOpen() rather than a status check on its own: the nightly cron is
      // what flips 'active' to 'expired', so for up to a day after expires_at
      // passes a listing still reads as active. The body already used the
      // fuller test and dropped the JobPosting markup, while this one let the
      // page stay indexable — so the window produced exactly the page Google
      // penalises, an indexed listing whose own banner says it has closed.
      //
      // While it is open, `unavailable_after` carries the expiry to the web
      // index the way validThrough carries it to the job panel. If the cron
      // is late, or the page is not recrawled on the day, Google still drops
      // it on time instead of showing a closed role until its next visit.
      robots: isOpen(job)
        ? {
            index: true,
            follow: true,
            ...(job.expires_at
              ? { unavailable_after: new Date(job.expires_at).toUTCString() }
              : {}),
          }
        : { index: false, follow: true },
    };
  }

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
  notFound();
}

export default async function JobOrLandingPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const resolved = await resolve(slug);

  if (resolved.kind === 'landing') {
    return (
      <TrackDistrictLanding track={resolved.track} district={resolved.district} locale={locale} />
    );
  }

  if (resolved.kind === 'none') notFound();

  const job = resolved.job;
  const open = isOpen(job);
  /*
    Not open is not always closed. Its company, an admin, and anybody who
    applied before an edit sent it back to review can read a draft, a listing
    in review or a rejected one — never published, or not now — and were told
    "this listing has closed", dated with an expiry still to come.
  */
  const published = jobIsPublic(job);

  if (open) {
    /*
      After the response, not beside it.

      This used to be an un-awaited promise started during render, which the
      platform is free to freeze the moment the page has streamed — so on a
      serverless host the count quietly depended on how fast the rest of the
      page was. `after()` is the sanctioned way to keep work alive past the
      response. A failed increment must still never break the page, hence
      the catch; recordJobView uses the service role, never cookies, which
      are gone by the time this runs.
    */
    after(() => recordJobView(slug).catch(() => {}));
  }

  // Google matches "jobs near me" on the region, which for Egypt is the
  // governorate. The job carries only its district, so the name is resolved
  // from the cached taxonomy rather than added to every job query.
  const governorates = await getGovernorates();
  const governorate = governorates.find((item) => item.id === job.district.governorate_id);
  const governorateName = governorate
    ? localized(locale, governorate.name_ar, governorate.name_en)
    : null;

  const tJobs = await getTranslations('jobs');
  const tTrack = await getTranslations('track');
  const tLanding = await getTranslations('landing');
  const districtName = localized(locale, job.district.name_ar, job.district.name_en);

  /*
    Structured data only for listings that are genuinely open, and only when
    every required field is really there — the builder returns null rather
    than emit a payload with a gap or a date that has already passed.
  */
  const posting = open
    ? jobPostingJsonLd(job, locale, governorateName, tJobs('requirements'))
    : null;

  return (
    <>
      {posting ? <JsonLd data={posting} /> : null}
      <JsonLd
        data={breadcrumbJsonLd(
          [
            { name: tJobs('title'), path: '/jobs' },
            {
              name: tLanding('title', { track: tTrack(job.track), district: districtName }),
              path: `/jobs/${buildLandingSlug(job.track, job.district.slug)}`,
            },
            { name: localized(locale, job.title_ar, job.title_en) },
          ],
          locale,
        )}
      />
      {open ? null : published ? <ClosedNotice /> : <UnpublishedNotice status={job.status} />}
      <JobDetailView job={job} locale={locale} open={open} published={published} />
    </>
  );
}

async function UnpublishedNotice({ status }: { status: JobStatus }) {
  const t = await getTranslations('jobs');
  const tStatus = await getTranslations('jobStatus');
  return (
    <div className="border-b border-border bg-muted">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <p className="text-sm font-medium">{t('notPublished')}</p>
        <p className="text-sm text-muted-foreground">{t('notPublishedBody', { status: tStatus(status) })}</p>
      </div>
    </div>
  );
}

async function ClosedNotice() {
  const t = await getTranslations('jobs');
  return (
    <div className="border-b border-warning/30 bg-warning-muted">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <p className="text-sm font-medium">{t('expired')}</p>
        <p className="text-sm text-muted-foreground">{t('expiredBody')}</p>
      </div>
    </div>
  );
}
