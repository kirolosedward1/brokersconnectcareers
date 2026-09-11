import { getTranslations } from 'next-intl/server';
import { BadgeCheck, Building2, CalendarClock, Eye, MapPin, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifiedBadge } from '@/components/verified-badge';
import { CompanyLogo } from '@/components/companies/company-logo';
import { CompensationCard, LeadsSourceBadge } from '@/components/jobs/compensation';
import { CommissionPicture } from '@/components/jobs/commission-picture';
import { commissionPicture, type CommissionPicture as CommissionPictureData } from '@/lib/earnings';
import { JobCard } from '@/components/jobs/job-card';
import { SaveJobButton } from '@/components/jobs/save-job-button';
import { ReportJobDialog } from '@/components/jobs/report-job-dialog';
import { AppliedNotice } from '@/components/jobs/applied-notice';
import { ShareJobButton } from '@/components/jobs/share-job-button';
import { formatDate, formatNumber, isoDate } from '@/lib/utils';
import { getSimilarJobs, type JobDetail } from '@/lib/queries/jobs';
import { getViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function JobDetailView({
  job,
  locale,
  open = true,
}: {
  job: JobDetail;
  locale: Locale;
  /**
   * Whether this listing is still taking applications. Decided by the page,
   * which already has to agree with the robots directive and the structured
   * data, so the same answer reaches all three.
   */
  open?: boolean;
}) {
  const t = await getTranslations('jobs');
  const tTrack = await getTranslations('track');
  const tType = await getTranslations('employmentType');
  const tExp = await getTranslations('experienceBand');
  const tCompanies = await getTranslations('companies');
  const tApply = await getTranslations('apply');

  const [similar, viewer] = await Promise.all([getSimilarJobs(job), getViewer()]);

  const title = localized(locale, job.title_ar, job.title_en);
  const description = localized(locale, job.description_ar, job.description_en);
  const companyName = localized(locale, job.company.name_ar, job.company.name_en);
  const districtName = localized(locale, job.district.name_ar, job.district.name_en);

  /**
   * Applying is a candidate action, so the button is a candidate's button.
   *
   * A signed-out reader still sees it — they are the people this page is for,
   * and the apply route sends them through sign-in with their destination
   * kept. It is only a signed-in employer or admin who is offered something
   * else, because for them the button leads nowhere: the database refuses the
   * application (see migration 15) whatever the interface shows.
   */
  const role = viewer?.profile?.role;
  const canApply = !role || role === 'candidate';

  // Has this candidate already applied? Cheap, and it changes the primary CTA.
  let alreadyApplied = false;
  let alreadySaved = false;
  /**
   * What this listing's commission is worth against their own record. Null
   * for everyone else: an employer reading their own advert has no record to
   * price it with, and a signed-out visitor has not told us anything.
   */
  let picture: CommissionPictureData | null = null;
  if (viewer?.profile?.role === 'candidate') {
    const supabase = await createClient();
    const [{ data: application }, { data: saved }, { data: record }] = await Promise.all([
      supabase
        .from('applications')
        .select('id')
        .eq('job_id', job.id)
        .eq('candidate_id', viewer.userId)
        .maybeSingle(),
      supabase
        .from('saved_jobs')
        .select('job_id')
        .eq('job_id', job.id)
        .eq('candidate_id', viewer.userId)
        .maybeSingle(),
      /*
        Filtered by user_id explicitly. This table has four read policies and
        one of them is `visibility = 'public'`, so a signed-in consultant sees
        their own row *and* every public profile in the directory — left to
        RLS, maybeSingle() matches many rows, errors, and hands back null.
        The dashboard learned this the hard way.
      */
      supabase
        .from('agent_profiles')
        .select('units_closed, volume_egp')
        .eq('user_id', viewer.profile.id)
        .maybeSingle(),
    ]);
    alreadyApplied = Boolean(application);
    alreadySaved = Boolean(saved);
    picture = commissionPicture(job, {
      unitsClosed: record?.units_closed ?? null,
      volumeEgp: record?.volume_egp ?? null,
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/jobs" className="hover:text-foreground">
          {t('title')}
        </Link>
        <span className="mx-2" aria-hidden>
          /
        </span>
        <span>{title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          <header>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <CompanyLogo
                  name={companyName}
                  logoUrl={job.company.logo_url}
                  seed={job.company.slug}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                <h1 className="text-2xl font-bold leading-tight text-balance">{title}</h1>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Link
                    href={`/companies/${job.company.slug}`}
                    className="font-medium hover:underline"
                  >
                    {companyName}
                  </Link>
                  <VerifiedBadge
                    status={job.company.verification_status}
                    label={tCompanies('verified')}
                  />
                  <span aria-hidden className="text-muted-foreground">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <MapPin className="size-3.5" aria-hidden />
                    {districtName}
                  </span>
                </p>
                </div>
              </div>

              <div className="rounded-lg bg-primary/10 px-4 py-3 text-center">
                <p className="text-2xl font-bold leading-none text-primary">
                  <span className="numeral">{formatNumber(job.seats, locale)}</span>
                </p>
                <p className="mt-1 text-xs text-primary/80">
                  {t('seatsLabel', { count: job.seats })}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <LeadsSourceBadge job={job} />
              <Badge variant="outline">{tTrack(job.track)}</Badge>
              <Badge variant="outline">{tType(job.employment_type)}</Badge>
              <Badge variant="outline">
                <Users aria-hidden />
                {tExp(job.experience_band)}
              </Badge>
            </div>
          </header>

          {/* Compensation is the differentiator, so it sits above the fold, in
              structured form, before any prose. */}
          <div className="mt-6">
            <CompensationCard job={job} locale={locale} />

            {picture ? <CommissionPicture picture={picture} locale={locale} /> : null}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {/*
              A closed listing offered "Apply" like any other, and the apply
              route then refused — a button whose only outcome is a page saying
              no. The listing stays readable, and its next step becomes the one
              that still exists.
            */}
            {!open ? (
              <div className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3">
                {/* Not a second copy of the banner at the top of the page.
                    That one says the listing is closed; this one is at the
                    place where somebody reached for Apply, and the useful
                    thing to add there is the date and the way onward. */}
                <p className="text-sm text-muted-foreground">
                  {job.expires_at
                    ? t('closedOn', { date: formatDate(job.expires_at, locale) })
                    : t('closedCtaBody')}
                </p>
                <Button asChild size="lg" className="mt-3">
                  <Link href="/jobs">{t('browseOpen')}</Link>
                </Button>
              </div>
            ) : !canApply ? (
              <p className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                {tApply('employerCannotApply')}
              </p>
            ) : alreadyApplied ? (
              <AppliedNotice />
            ) : (
              <Button asChild size="lg">
                <Link href={`/jobs/${job.slug}/apply`}>{t('apply')}</Link>
              </Button>
            )}
            <SaveJobButton
              jobId={job.id}
              jobSlug={job.slug}
              initialSaved={alreadySaved}
              canSave={Boolean(viewer?.profile)}
              labels={{ save: t('save'), saved: t('saved') }}
            />
            <ShareJobButton title={title} />
            <ReportJobDialog
              jobId={job.id}
              jobSlug={job.slug}
              signedIn={Boolean(viewer?.profile)}
            />
          </div>

          <section className="mt-8" aria-labelledby="description-heading">
            <h2 id="description-heading" className="text-lg font-semibold">
              {t('description')}
            </h2>
            <div className="mt-3 whitespace-pre-line leading-relaxed">{description}</div>
          </section>

          {job.requirements_ar ? (
            <section className="mt-8" aria-labelledby="requirements-heading">
              <h2 id="requirements-heading" className="text-lg font-semibold">
                {t('requirements')}
              </h2>
              <div className="mt-3 whitespace-pre-line leading-relaxed">{job.requirements_ar}</div>
            </section>
          ) : null}

          {job.job_developers.length ? (
            <section className="mt-8" aria-labelledby="developers-heading">
              <h2 id="developers-heading" className="text-lg font-semibold">
                {t('developers')}
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {job.job_developers.map(({ developer }) => (
                  <li key={developer.id}>
                    <Badge variant="outline" size="lg">
                      {localized(locale, developer.name_ar, developer.name_en)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {job.published_at ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden />
                <time dateTime={isoDate(job.published_at)} >
                  {t('postedOn', { date: formatDate(job.published_at, locale) })}
                </time>
              </span>
            ) : null}
            {job.expires_at ? (
              <time dateTime={isoDate(job.expires_at)} >
                {t('expiresOn', { date: formatDate(job.expires_at, locale) })}
              </time>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3.5" aria-hidden />
              {t('views', { count: formatNumber(job.view_count, locale) })}
            </span>
          </p>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4" aria-hidden />
                {t('aboutCompany')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <CompanyLogo
                  name={companyName}
                  logoUrl={job.company.logo_url}
                  seed={job.company.slug}
                  size="sm"
                />
                <p className="min-w-0 font-medium">{companyName}</p>
              </div>
              {/* Only for a company that holds the badge. There is no matching
                  line for one that does not: 'unverified' covers a company
                  that never submitted, one whose papers are with a reviewer
                  and one that was turned down, and a single sentence would be
                  false for two of the three. */}
              {job.company.verification_status === 'verified' ? (
                <p className="flex items-start gap-2 leading-relaxed text-muted-foreground">
                  <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {t('verifiedMeaning')}
                </p>
              ) : null}
              {job.company.about_ar || job.company.about_en ? (
                <p className="leading-relaxed text-muted-foreground">
                  {localized(locale, job.company.about_ar, job.company.about_en)}
                </p>
              ) : null}
              <Button asChild variant="outline" className="w-full">
                <Link href={`/companies/${job.company.slug}`}>{tCompanies('title')}</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Sticky apply on mobile: the CTA should never be a scroll away.
              data-apply-bar is read by one rule in globals.css, which gives the
              footer room to clear this. Without it the bar sat over the last
              73px of the document at maximum scroll, so the theme switcher and
              the copyright line were unreachable on a phone — on every listing
              on the site. Padding anything inside <main> cannot fix that: the
              footer is still the last thing in the document. */}
          {canApply && open ? (
          <div
            data-apply-bar
            className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background p-3 lg:hidden"
          >
            {alreadyApplied ? (
              <AppliedNotice full />
            ) : (
              <Button asChild className="w-full" size="lg">
                <Link href={`/jobs/${job.slug}/apply`}>{tApply('submit')}</Link>
              </Button>
            )}
          </div>
          ) : null}
        </aside>
      </div>

      {similar.length ? (
        <section className="mt-14 pb-20 lg:pb-0" aria-labelledby="similar-heading">
          <h2 id="similar-heading" className="text-lg font-semibold">
            {t('similarJobs')}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {similar.map((item) => (
              <li key={item.id}>
                <JobCard job={item} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
