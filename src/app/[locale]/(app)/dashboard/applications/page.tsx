import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Building2, MapPin } from 'lucide-react';
import { EmptyIllustration } from '@/components/illustration';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApplicationSteps } from '@/components/dashboard/application-steps';
import { WithdrawButton } from '@/components/dashboard/withdraw-button';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { formatDate, formatDayMonth, isoDate } from '@/lib/utils';
import type { ApplicationStatus, JobStatus } from '@/lib/supabase/database.types';
import { displayJobStatus } from '@/lib/job-state';
import { applicationProgress, canWithdraw, type ApplicationEventStamp, type ProgressPill } from '@/lib/application-stages';
import { WithdrawnBadge } from '@/components/applications/withdrawn-badge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('applications'), robots: { index: false, follow: false } };
}

export default async function ApplicationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const viewer = await requireCandidate(locale);

  const supabase = await createClient();
  /*
    Scoped explicitly, with row-level security still behind it.

    These are not two copies of one rule. RLS decides what may be seen; this
    decides what to look at, which is what lets an index serve the query
    instead of a sequential scan whose filter calls a SECURITY DEFINER function
    per row. Measured on production against 22,432 applications: two seconds
    without it, two and a half milliseconds with. And the drift it risks only
    goes one way — a wrong filter shows fewer rows, never more, because the
    policy is still the thing deciding.
  */
  /*
    The error is read, not dropped.

    "لسه ما قدّمتش على أي وظيفة" is the one sentence this page must not say to
    somebody who has applied to six. A failed read used to produce exactly
    that, because the error went nowhere and `data` came back null.
  */
  const { data, error } = await supabase
    .from('applications')
    .select(
      `
      id, status, created_at, decision_note, employer_viewed_at, withdrawn_at,
      history:application_events (from_status, to_status, created_at),
      job:jobs (
        slug, status, expires_at, title_ar, title_en,
        company:companies (name_ar, name_en, slug),
        district:districts (name_ar, name_en)
      )
    `,
    )
    .eq('candidate_id', viewer.userId)
    .order('created_at', { ascending: false });

  if (error) raise(error, 'loading your applications');

  const applications = (data ?? []) as unknown as {
    id: string;
    status: ApplicationStatus;
    decision_note: string | null;
    employer_viewed_at: string | null;
    withdrawn_at: string | null;
    created_at: string;
    history: ApplicationEventStamp[] | null;
    job: {
      slug: string;
      status: JobStatus;
      expires_at: string | null;
      title_ar: string;
      title_en: string | null;
      company: { name_ar: string; name_en: string | null; slug: string };
      district: { name_ar: string; name_en: string };
    } | null;
  }[];

  const t = await getTranslations('dashboard');
  const tMine = await getTranslations('myApplications');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">{t('applications')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('applicationsLede')}</p>
      </header>

      {applications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center">
          <EmptyIllustration name="apply" />
          <p className="font-medium">{t('emptyApplications')}</p>
          <Button asChild className="mt-4">
            <Link href="/jobs">{t('emptyApplicationsCta')}</Link>
          </Button>
        </div>
      ) : (
        /* One surface, ruled rows. Each application was a card of its own with
           up to two more bordered boxes inside it — the listing's state, the
           company's reason — so a page of five applications was fifteen
           rectangles. The notes are sentences about the row they sit in, and
           are set as that: a line of text with a rule down its leading edge. */
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {applications.map((application) => {
        const job = application.job;
        if (!job) return null;

        const progress = applicationProgress({
          status: application.status,
          created_at: application.created_at,
          employer_viewed_at: application.employer_viewed_at,
          withdrawn_at: application.withdrawn_at,
          events: application.history ?? [],
        });
        const title = localized(locale, job.title_ar, job.title_en);
        const company = localized(locale, job.company.name_ar, job.company.name_en);
        const district = localized(locale, job.district.name_ar, job.district.name_en);
        const place = `${company} · ${district}`;

        return (
          <li
            key={application.id}
            className="min-w-0 overflow-hidden px-4 py-1.5 sm:px-5"
          >
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold leading-5">
                  <Link href={`/jobs/${job.slug}`} className="hover:underline" title={title}>
                    {title}
                  </Link>
                </h2>
                <p className="truncate text-xs leading-4 text-muted-foreground" title={place}>
                  <Building2 className="me-1 inline size-3 align-text-bottom" aria-hidden />
                  {company}
                  <span aria-hidden> · </span>
                  <MapPin className="me-1 inline size-3 align-text-bottom" aria-hidden />
                  {district}
                </p>
              </div>

              <span className="shrink-0">
                <StatusPill pill={progress.pill} label={pillLabel(tMine, progress.pill)} />
              </span>
            </div>

            {/*
              The stepper and the one line under it share the same measure, so
              neither runs the width of the card. The line is the day it was
              sent, except a withdrawal, which the dots do not say themselves.
            */}
            <div className="mt-1.5 w-full max-w-[420px]">
              <ApplicationSteps progress={progress} />

              <div className="mt-1 flex min-w-0 items-center gap-3">
                {progress.summary === 'withdrawn' ? (
                  <p className="min-w-0 truncate text-xs leading-4 text-muted-foreground">
                    {progress.summaryDate
                      ? `${tMine('lineWithdrawn')} · ${formatDayMonth(progress.summaryDate, locale)}`
                      : tMine('lineWithdrawn')}
                  </p>
                ) : (
                  /* Not `.numeral`: "قدّمت في 10 سبتمبر 2026" is a sentence with a
                     date in it, and forcing it left-to-right put the date before
                     the words. Bidi lays out digits inside Arabic text correctly
                     on its own. */
                  <time
                    dateTime={isoDate(application.created_at)}
                    className="min-w-0 truncate text-xs leading-4 text-muted-foreground"
                  >
                    {t('appliedOn', { date: formatDate(application.created_at, locale) })}
                  </time>
                )}

                {/* Withdrawing is only offered while the outcome is still open. */}
                {canWithdraw(application.status) ? (
                  <WithdrawButton applicationId={application.id} label={t('withdraw')} title={title} />
                ) : null}
              </div>
            </div>

            {/*
              What happened to the listing, when something did.

              An application whose listing is no longer active used to read
              exactly like one whose listing was still up — and, before
              migration 45, an application to a listing that had gone back for
              review disappeared from this page altogether. Neither is a state
              to leave somebody guessing at: the question a candidate has here
              is whether anybody is still reading.
            */}
            {/*
              The date, not the label — the last page in the product still
              reading the stored status directly.

              The nightly cron that writes `expired` needs a service-role key
              production does not have, so a listing whose window closed sits
              at `active` indefinitely; one has since 10 September. Everywhere
              else asks the date: the board filters on it, the job card and
              /dashboard/saved mark the role closed, the employer console
              relabels it. Here the note simply did not appear, so a candidate
              waiting on a reply was the only person on the platform still
              being told the listing was open.
            */}
            {displayJobStatus(job) !== 'active' ? (
              <p className="mt-1.5 border-s-2 border-border ps-3 text-xs leading-relaxed text-muted-foreground">
                {(() => {
                  const shown = displayJobStatus(job);
                  return shown === 'closed' || shown === 'expired'
                    ? t('applicationListingClosed')
                    : t('applicationListingOffBoard');
                })()}
              </p>
            ) : null}

            {/* The reason, when the company gave one. This is the whole point
                of the board: a decision you can act on rather than guess at. */}
            {application.decision_note ? (
              <div className="mt-1.5 border-s-2 border-primary/40 ps-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('decisionFromCompany')}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed">{application.decision_note}</p>
              </div>
            ) : null}
            </li>
          );
        })}
        </ul>
      )}
    </div>
  );
}

function pillLabel(
  tMine: (key: 'pillNew' | 'pillReview' | 'pillHired' | 'pillRejected' | 'pillWithdrawn') => string,
  pill: ProgressPill,
): string {
  switch (pill) {
    case 'new':
      return tMine('pillNew');
    case 'review':
      return tMine('pillReview');
    case 'hired':
      return tMine('pillHired');
    case 'rejected':
      return tMine('pillRejected');
    case 'withdrawn':
      return tMine('pillWithdrawn');
  }
}

/** The pill for a progress result. Withdrawn keeps the grey pair specified for that state. */
function StatusPill({ pill, label }: { pill: ProgressPill; label: string }) {
  if (pill === 'withdrawn') return <WithdrawnBadge label={label} />;
  return <Badge variant={pill === 'rejected' ? 'destructive' : pill === 'new' ? 'default' : 'primary'}>{label}</Badge>;
}
