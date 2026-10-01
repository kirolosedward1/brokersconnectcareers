import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BriefcaseBusiness, Eye, MapPin, Pencil, Plus, Users } from 'lucide-react';
import { EmptyIllustration } from '@/components/illustration';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/pagination';
import { JobStatusActions } from '@/components/employer/job-status-actions';
import { requireEmployer } from '@/lib/auth';
import { displayJobStatus, jobIsLive } from '@/lib/job-state';
import { AppealPanel } from '@/components/moderation/appeal-panel';
import { getAppealState } from '@/lib/moderation/appeal-state';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { formatDate, formatNumber, isoDate } from '@/lib/utils';
import type { JobRow, JobStatus } from '@/lib/supabase/database.types';

const STATUS_VARIANT: Record<JobStatus, 'default' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  draft: 'default',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'employer' });
  return { title: t('jobs'), robots: { index: false, follow: false } };
}

/** Listings per console page. */
const PAGE_SIZE = 25;

export default async function EmployerJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const requested = Number.parseInt((await searchParams).page ?? '1', 10);
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const t = await getTranslations('employer');
  const tStatus = await getTranslations('jobStatus');
  const tJobs = await getTranslations('jobs');

  if (!viewer.company) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <p className="font-medium">{t('createCompanyFirst')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('createCompanyFirstBody')}</p>
        <Button asChild className="mt-5">
          <Link href="/employer/company">{t('company')}</Link>
        </Button>
      </div>
    );
  }

  const supabase = await createClient();
  /*
    The error is read, not dropped.

    An empty listings page offers "post your first listing", which is a strange
    thing to show a brokerage with four live adverts — and the console's own
    tiles, which come from a different call, would be counting them at the same
    time.
  */
  /*
    A page at a time, and only the columns this list draws.

    This read had neither bound. A brokerage a year in — 489 listings, most of
    them expired, in the load-test dataset — got every one of them, `*` and
    all, on every visit: 2.4 MB out of the database and a 5.3 MB page, with an
    applicant count per listing that the policies price per application.
    Newest first, so page one is what an employer came to look at.
  */
  const listings = (page: number) =>
    supabase
      .from('jobs')
      .select(
        `
        id, slug, title_ar, title_en, status, seats, view_count,
        published_at, expires_at, created_at, rejection_note,
        district:districts (name_ar, name_en),
        applications (count)
      `,
        { count: 'exact' },
      )
      .eq('company_id', viewer.company!.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  let page = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 1000) : 1;
  let { data, error, count } = await listings(page);
  // A page past the end is answered with page one rather than an error:
  // PostgREST refuses an unsatisfiable range outright (PGRST103).
  if (error?.code === 'PGRST103' || (!error && page > 1 && !data?.length)) {
    page = 1;
    ({ data, error, count } = await listings(page));
  }

  if (error) raise(error, 'loading your listings');

  const total = count ?? data?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const jobs = (data ?? []) as unknown as (Pick<
    JobRow,
    | 'id' | 'slug' | 'title_ar' | 'title_en' | 'status' | 'seats' | 'view_count'
    | 'published_at' | 'expires_at' | 'created_at' | 'rejection_note'
  > & {
    district: { name_ar: string; name_en: string } | null;
    applications: { count: number }[];
  })[];


  // A rejected listing can be appealed — "we think this was a mistake" — as
  // well as edited and resubmitted. Asked only for the rejected ones.
  const appeals = new Map(
    await Promise.all(
      jobs
        .filter((job) => job.status === 'rejected')
        .map(async (job) => [job.id, await getAppealState(supabase, 'job', job.id)] as const),
    ),
  );
  return (
    <div className="space-y-6">
      {/* Stacked on a phone rather than wrapped: justify-between put the
          button alone on the second line and shoved it to the far edge, which
          reads as a mistake. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">{t('jobs')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('jobsLede')}</p>
        </div>
        <Button asChild className="self-start">
          <Link href="/employer/jobs/new">
            <Plus aria-hidden />
            {t('newJob')}
          </Link>
        </Button>
      </header>

      <p className="text-sm text-muted-foreground">
        {tJobs('resultsCount', { count: total })}
      </p>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <EmptyIllustration name="write" />
          <p className="font-medium">{t('noJobs')}</p>
          <Button asChild className="mt-5">
            <Link href="/employer/jobs/new">{t('newJob')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => {
            const applicants = job.applications?.[0]?.count ?? 0;
            /*
              The date, not the label.

              `status` is relabelled by a nightly cron, and on production that
              cron returns 503 for want of a service-role key — so a listing
              has been sitting here badged "منشورة", linked to its public page,
              and showing an expiry date in the past, while the board (which
              filters on the date) showed nothing. Whatever this console says
              about a listing has to be the same thing a candidate would see.
            */
            const live = jobIsLive(job);
            const shownStatus = displayJobStatus(job);
            return (
              <li key={job.id} className="rounded-xl border border-border bg-card p-5">
                <div>
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-semibold">
                      {live ? (
                        <Link href={`/jobs/${job.slug}`} className="hover:underline">
                          {localized(locale, job.title_ar, job.title_en)}
                        </Link>
                      ) : (
                        localized(locale, job.title_ar, job.title_en)
                      )}
                      <Badge variant={STATUS_VARIANT[shownStatus]}>{tStatus(shownStatus)}</Badge>
                    </h2>

                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      {job.district ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" aria-hidden />
                          {localized(locale, job.district.name_ar, job.district.name_en)}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <BriefcaseBusiness className="size-3.5" aria-hidden />
                        <span className="numeral">{formatNumber(job.seats, locale)}</span>
                        {tJobs('seatsLabel', { count: job.seats })}
                      </span>
                      {/*
                        Shown on anything that was ever published, not only on
                        what is live.

                        The console's "views" tile sums view_count across every
                        listing the company has, and this line is where that
                        number is supposed to come apart into its pieces — but
                        it appeared only on live listings, so a company with a
                        closed advert could not reconcile the total with
                        anything on the page. The views a finished listing
                        earned are a fact worth keeping.
                      */}
                      {job.published_at ? (
                        <span className="numeral inline-flex items-center gap-1">
                          <Eye className="size-3.5" aria-hidden />
                          {formatNumber(job.view_count, locale)}
                        </span>
                      ) : null}
                      {/* No `.numeral` on the expiry. It forces left-to-right,
                          and this is a sentence rather than a figure — "تنتهي
                          في 13 سبتمبر" came out with the date before the words.
                          A date inside RTL prose orders itself correctly. */}
                      {job.expires_at && live ? (
                        <time dateTime={isoDate(job.expires_at)}>
                          {tJobs('expiresOn', { date: formatDate(job.expires_at, locale) })}
                        </time>
                      ) : null}
                    </p>

                    {job.rejection_note ? (
                      <p className="mt-2 rounded-md bg-destructive-muted p-2 text-xs text-destructive">
                        {job.rejection_note}
                      </p>
                    ) : null}
                    {job.status === 'rejected' ? (
                      <AppealPanel subjectType="job" subjectId={job.id} state={appeals.get(job.id) ?? null} />
                    ) : null}
                  </div>
                </div>

                {/* A colour each, and each one means something rather than
                    varying for variety: blue is where the new information is,
                    teal changes the listing, red ends it. Three identical grey
                    buttons made "close this advert" look exactly as ordinary
                    as "edit" — which is the one place on this screen where
                    they should not look alike. */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline" className="text-primary">
                    <Link href={`/employer/jobs/${job.id}/applicants`}>
                      <Users aria-hidden />
                      <span>
                        {t.rich('pipelineCount', {
                          count: applicants,
                          v: (chunks) => <span className="numeral">{chunks}</span>,
                        })}
                      </span>
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" className="text-accent-foreground">
                    <Link href={`/employer/jobs/${job.id}/edit`}>
                      <Pencil aria-hidden />
                      {t('editJob')}
                    </Link>
                  </Button>
                  <JobStatusActions
                    jobId={job.id}
                    status={shownStatus}
                    labels={{
                      close: t('closeJob'),
                      reopen: t('reopenJob'),
                      reopenHint: t('reopenHint'),
                      submit: t('submitForReview'),
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        buildHref={(next) => (next > 1 ? `/employer/jobs?page=${next}` : '/employer/jobs')}
      />
    </div>
  );
}
