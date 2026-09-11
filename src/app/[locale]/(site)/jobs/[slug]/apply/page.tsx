import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect, Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { ApplyForm } from '@/components/jobs/apply-form';
import { Button } from '@/components/ui/button';
import { getJobBySlug } from '@/lib/queries/jobs';
import { jobIsLive } from '@/lib/job-state';
import { getViewer } from '@/lib/auth';
import { JobCard } from '@/components/jobs/job-card';
import { EMPTY_FILTERS, queryJobs, type JobListItem } from '@/lib/queries/jobs';
import { optional } from '@/lib/queries/error';
import { rankJobs } from '@/lib/match';

import { formatDate } from '@/lib/utils';
import { createClient } from '@/lib/supabase/server';

type Params = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'apply' });
  // The apply form is a private step; the job page is the indexable surface.
  return { title: t('submit'), robots: { index: false, follow: true } };
}

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ applied?: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const justApplied = (await searchParams).applied === '1';
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const t = await getTranslations('apply');
  const tJobs = await getTranslations('jobs');

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);

  const isOpen = jobIsLive(job);

  if (!isOpen) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">{tJobs('expired')}</h1>
        <p className="mt-2 text-muted-foreground">{tJobs('expiredBody')}</p>
        <Button asChild className="mt-6">
          <Link href="/jobs">{tJobs('title')}</Link>
        </Button>
      </div>
    );
  }

  const viewer = await getViewer();

  if (!viewer) {
    redirect({ href: { pathname: '/sign-in', query: { next: `/jobs/${slug}/apply` } }, locale });
  }
  if (!viewer!.profile) {
    redirect({ href: { pathname: '/onboarding', query: { next: `/jobs/${slug}/apply` } }, locale });
  }

  const profile = viewer!.profile!;

  // An employer landing here is almost always a mis-click; send them somewhere
  // useful rather than letting them apply to their own board.
  if (profile.role === 'employer') {
    redirect({ href: `/jobs/${slug}`, locale });
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('applications')
    .select('id, created_at')
    .eq('job_id', job.id)
    .eq('candidate_id', viewer!.userId)
    .maybeSingle();

  /*
    What to show after the confirmation, fetched only when there is going to be
    a confirmation to show. Ranked against this consultant's own profile by the
    same function the dashboard uses, with the listing they just applied to and
    everything else they have applied to removed — suggesting a role somebody
    has already applied for is not a suggestion.
  */
  let nextRoles: { job: JobListItem }[] = [];
  let personalised = false;
  if (existing && justApplied) {
    const [openRoles, { data: agent }, { data: mine }] = await Promise.all([
      optional(queryJobs({ ...EMPTY_FILTERS }), { jobs: [], total: 0, pageCount: 0, page: 1 }),
      supabase
        .from('agent_profiles')
        .select('tracks, district_ids, years_experience')
        .eq('user_id', viewer!.userId)
        .maybeSingle(),
      supabase.from('applications').select('job_id'),
    ]);

    const appliedTo = new Set((mine ?? []).map((row) => row.job_id));
    const ranked = rankJobs(
      openRoles.jobs.filter((role) => role.id !== job.id && !appliedTo.has(role.id)),
      {
        tracks: agent?.tracks ?? null,
        districtIds: agent?.district_ids ?? null,
        yearsExperience: agent?.years_experience ?? null,
      },
    );
    personalised = ranked.personalised;
    nextRoles = ranked.ranked.slice(0, 2);
  }

  if (existing) {
    /*
      Two different messages for the same database row, and the difference
      matters more than it looks.

      Applying used to end here, on "you already applied to this job before".
      The form set a success flag and then the server action's revalidation
      re-rendered this page, which found the row that had just been written and
      replaced the whole component — success state and all — with a sentence
      that reads as a refusal. The most important moment in the product told
      everybody who completed it that they were too late.

      So the confirmation lives here, on the server, keyed to ?applied=1. It
      survives the revalidation that destroyed the old one, it survives a
      refresh, and it can say what the client component never could: which
      role, which company, what day, and what happens next.
    */
    if (justApplied) {
      return (
        <div className="mx-auto max-w-lg px-4 py-12">
          <div className="rounded-2xl border border-success/30 bg-success-muted p-6 text-center">
            <CheckCircle2 className="mx-auto size-9 text-success" aria-hidden />
            <h1 className="mt-3 text-xl font-bold">{t('success')}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t('successBody')}</p>
          </div>

          <dl className="mt-6 divide-y divide-border rounded-xl border border-border">
            <div className="flex items-start justify-between gap-4 p-4">
              <dt className="text-sm text-muted-foreground">{t('labelJob')}</dt>
              <dd className="text-end text-sm font-medium">{title}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 p-4">
              <dt className="text-sm text-muted-foreground">{t('labelCompany')}</dt>
              <dd className="text-end text-sm font-medium">{company}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 p-4">
              <dt className="text-sm text-muted-foreground">{t('labelDate')}</dt>
              {/* No .numeral here. formatDate returns "12 مارس 2026" — Arabic
                  words next to digits — and forcing that run left-to-right is
                  the bug the class exists to prevent, not a use of it. The
                  bidi algorithm already reads it correctly. */}
              <dd className="text-end text-sm font-medium">
                {formatDate(existing.created_at, locale)}
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/dashboard/applications">{t('viewApplications')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/jobs">{tJobs('title')}</Link>
            </Button>
          </div>

          {/*
            Where the session used to end.

            The strongest moment to show somebody another role is the one just
            after they applied for one: they are already in the mindset, their
            details are already saved, and the next application costs them
            almost nothing. Two buttons and a full stop threw that away.

            Ranked against their own profile and labelled the same way the
            dashboard labels it, so this is the product's one notion of
            relevance rather than a second one invented here. Nothing renders
            if there is nothing to show.
          */}
          {nextRoles.length ? (
            <section className="mt-10" aria-labelledby="next-roles">
              <h2 id="next-roles" className="text-lg font-semibold">
                {personalised ? t('nextRolesMatched') : t('nextRoles')}
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {nextRoles.map(({ job: role }) => (
                  <li key={role.id}>
                    <JobCard job={role} locale={locale} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">{t('alreadyApplied')}</h1>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link href="/dashboard/applications">{t('viewApplications')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${slug}`}>{title}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-bold">{t('title', { job: title })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {company} · {t('subtitle')}
        </p>
      </header>

      <ApplyForm
        jobId={job.id}
        jobSlug={slug}
        userId={viewer!.userId}
        defaultName={profile.full_name}
        defaultPhone={profile.whatsapp_phone}
      />
    </div>
  );
}
