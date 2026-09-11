import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Building2, Eye, MapPin } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WithdrawButton } from '@/components/dashboard/withdraw-button';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { formatDate, isoDate } from '@/lib/utils';
import type { ApplicationStatus, JobStatus } from '@/lib/supabase/database.types';

const STATUS_VARIANT: Record<ApplicationStatus, 'default' | 'primary' | 'success' | 'destructive'> = {
  new: 'default',
  shortlisted: 'primary',
  interview: 'primary',
  hired: 'success',
  rejected: 'destructive',
};

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
      id, status, created_at, decision_note, employer_viewed_at,
      job:jobs (
        slug, status, title_ar, title_en,
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
    created_at: string;
    job: {
      slug: string;
      status: JobStatus;
      title_ar: string;
      title_en: string | null;
      company: { name_ar: string; name_en: string | null; slug: string };
      district: { name_ar: string; name_en: string };
    } | null;
  }[];

  const t = await getTranslations('dashboard');
  const tStatus = await getTranslations('applicationStatus');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('applications')}</h1>
        <p className="mt-1 text-muted-foreground">{t('applicationsLede')}</p>
      </header>

      {applications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="font-medium">{t('emptyApplications')}</p>
          <Button asChild className="mt-5">
            <Link href="/jobs">{t('emptyApplicationsCta')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
      {applications.map((application) => {
        const job = application.job;
        if (!job) return null;

        return (
          <li
            key={application.id}
            className="rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">
                  <Link href={`/jobs/${job.slug}`} className="hover:underline">
                    {localized(locale, job.title_ar, job.title_en)}
                  </Link>
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="size-3.5" aria-hidden />
                    {localized(locale, job.company.name_ar, job.company.name_en)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden />
                    {localized(locale, job.district.name_ar, job.district.name_en)}
                  </span>
                </p>
              </div>

              <Badge variant={STATUS_VARIANT[application.status]} size="lg">
                {tStatus(application.status)}
              </Badge>
            </div>

            {/*
              The one thing somebody wants to know after applying.

              Not a status — the status is still `new`, and saying anything
              else would be inventing progress. Just that a person at the
              company has had the application on their screen, which is what
              employer_viewed_at now records and, until the inbox started
              writing it, could not honestly have been shown at all.

              Only while the outcome is open. Once the status moves, the status
              is the news and this becomes a smaller, older fact competing with
              it.
            */}
            {application.status === 'new' && application.employer_viewed_at ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-muted px-3 py-1 text-xs font-medium text-success">
                <Eye className="size-3.5" aria-hidden />
                {t('applicationOpened')}
              </p>
            ) : null}

            {/*
              What happened to the listing, when something did.

              An application whose listing is no longer active used to read
              exactly like one whose listing was still up — and, before
              migration 45, an application to a listing that had gone back for
              review disappeared from this page altogether. Neither is a state
              to leave somebody guessing at: the question a candidate has here
              is whether anybody is still reading.
            */}
            {job.status !== 'active' ? (
              <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
                {job.status === 'closed' || job.status === 'expired'
                  ? t('applicationListingClosed')
                  : t('applicationListingOffBoard')}
              </p>
            ) : null}

            {/* The reason, when the company gave one. This is the whole point
                of the board: a decision you can act on rather than guess at. */}
            {application.decision_note ? (
              <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('decisionFromCompany')}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{application.decision_note}</p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              {/* Not `.numeral`: "قدّمت يوم 10 سبتمبر" is a sentence with a
                  date in it, and forcing it left-to-right put the date before
                  the words. Bidi lays out digits inside Arabic text correctly
                  on its own. */}
              <time
                dateTime={isoDate(application.created_at)}
                className="text-xs text-muted-foreground"
              >
                {t('appliedOn', { date: formatDate(application.created_at, locale) })}
              </time>

              {/* Withdrawing is only offered while the outcome is still open. */}
              {application.status === 'new' || application.status === 'shortlisted' ? (
                <WithdrawButton applicationId={application.id} label={t('withdraw')} />
              ) : null}
            </div>
            </li>
          );
        })}
        </ul>
      )}
    </div>
  );
}
