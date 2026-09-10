import { Check, CircleDashed, Clock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import type { CompanyRow } from '@/lib/supabase/database.types';

/**
 * What is left before this company can receive an applicant.
 *
 * An employer who has created their company and posted nothing was shown six
 * tiles reading zero, a trend measured against a week with no applicants, and
 * no indication of what to do. Zeroes are not information at that stage; they
 * are analytics pretending a product is in use, and they answer none of the
 * three questions somebody has on their first morning — what is done, what is
 * left, what happens after.
 *
 * So the tiles stand down until there is a listing, and this stands in.
 *
 * Every row reads real state. Nothing here is a suggestion or a score: the
 * company row says whether the profile is filled in, the verification column
 * says where the paperwork stands, and the summary counts the listings. A row
 * cannot be ticked by doing anything other than the thing it names.
 */
export async function SetupChecklist({
  company,
  liveJobs,
  pendingJobs,
  draftJobs,
}: {
  company: CompanyRow | null;
  liveJobs: number;
  pendingJobs: number;
  draftJobs: number;
}) {
  const t = await getTranslations('employer');

  /*
    "Filled in" is about what a candidate reads, not about what the form
    accepted. A company with a name and nothing else renders as a name and a
    blank card on the listing, which is why the description and the mark are
    what count here rather than the row simply existing.
  */
  const profileDone = Boolean(company?.about_ar?.trim() && company?.logo_url);
  const verification = company?.verification_status ?? 'unverified';
  const hasListing = liveJobs + pendingJobs > 0;

  const steps = [
    {
      key: 'company',
      label: t('setupCompany'),
      hint: t('setupCompanyHint'),
      state: profileDone ? 'done' : 'todo',
      href: '/employer/company',
    },
    {
      key: 'verification',
      label: t('setupVerification'),
      hint:
        verification === 'rejected' ? t('setupVerificationRedo') : t('setupVerificationHint'),
      // Pending is its own state rather than a tick: the paperwork is with a
      // reviewer, and telling somebody it is done when a human has not looked
      // is how a company concludes the platform lies to them.
      state: verification === 'verified' ? 'done' : verification === 'pending' ? 'waiting' : 'todo',
      href: '/employer/company',
    },
    {
      key: 'job',
      label: t('setupFirstJob'),
      hint: pendingJobs > 0 ? t('setupFirstJobPending') : draftJobs > 0 ? t('setupFirstJobDraft') : t('setupFirstJobHint'),
      state: liveJobs > 0 ? 'done' : pendingJobs > 0 ? 'waiting' : 'todo',
      href: draftJobs > 0 ? '/employer/jobs' : '/employer/jobs/new',
    },
  ] as const;

  const done = steps.filter((step) => step.state === 'done').length;

  return (
    <section
      aria-labelledby="employer-setup"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="employer-setup" className="text-lg font-semibold">
            {t('setupTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('setupLede')}</p>
        </div>
        {/* Not `.numeral`. The phrase is "2 من 3" — a translated sentence with
            digits in it, and forcing the whole thing left-to-right reads it
            backwards. Bidi already renders a digit inside Arabic text
            correctly; only a bare run of digits ever needs isolating. */}
        <p className="shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-medium">
          {t('setupProgress', { done, total: steps.length })}
        </p>
      </div>

      <ol className="mt-5 space-y-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3">
            <span
              aria-hidden
              className={
                'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ' +
                (step.state === 'done'
                  ? 'bg-success text-white'
                  : step.state === 'waiting'
                    ? 'bg-warning-muted text-warning'
                    : 'border border-border text-muted-foreground')
              }
            >
              {step.state === 'done' ? (
                <Check className="size-3.5" />
              ) : step.state === 'waiting' ? (
                <Clock className="size-3.5" />
              ) : (
                <CircleDashed className="size-3.5" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className={step.state === 'done' ? 'font-medium text-muted-foreground' : 'font-medium'}>
                {step.label}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{step.hint}</p>
            </div>

            {step.state === 'done' ? null : (
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link href={step.href}>{t('setupGo')}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>

      {/*
        The one action worth making unmissable. Verification is not a gate on
        posting — an unverified company may publish one listing — so a company
        waiting on paperwork is not blocked from the thing they came to do, and
        the button should not imply they are.
      */}
      {hasListing ? null : (
        <Button asChild size="lg" className="mt-5 w-full sm:w-auto">
          <Link href="/employer/jobs/new">{t('setupPostFirstJob')}</Link>
        </Button>
      )}
    </section>
  );
}
