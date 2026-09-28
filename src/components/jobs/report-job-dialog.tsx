'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { EyeOff, Flag, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { SubmitButton } from '@/components/ui/submit-button';
import { AGENT_REPORT_REASONS, COMPANY_REPORT_REASONS, REPORT_REASONS } from '@/lib/taxonomy';
import { reportTarget, type ReportRefusal, type ReportTarget } from '@/lib/actions/reports';
import { reach } from '@/lib/reach';
import type { ReportReason } from '@/lib/supabase/database.types';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * Reporting needs an account now, so this has a signed-out state: a link to
 * sign in that comes back to the listing, rather than a form that accepts the
 * report and then refuses it.
 *
 * The keyboard behaviour that used to live here — the focus trap, Escape, the
 * return of focus to whatever opened it — moved into ui/Dialog, because it was
 * the only correct modal in the product and anything else needing one would
 * have grown a second, worse copy of it.
 */
export function ReportJobDialog({
  jobId,
  signedIn,
  jobSlug,
}: {
  jobId: string;
  signedIn: boolean;
  jobSlug: string;
}) {
  const t = useTranslations('jobs');
  return (
    <ReportDialog
      target="job"
      targetId={jobId}
      signedIn={signedIn}
      returnPath={`/jobs/${jobSlug}`}
      label={t('report')}
    />
  );
}

const REASONS_FOR: Record<ReportTarget, readonly ReportReason[]> = {
  job: REPORT_REASONS,
  company: COMPANY_REPORT_REASONS,
  agent: AGENT_REPORT_REASONS,
};

/** The refusals the action names, each with its own sentence. */
const REFUSAL_COPY = {
  already_reported: 'alreadyReported',
  rate_limit: 'rateLimit',
  burst_limit: 'burstLimit',
  new_account_limit: 'newAccountLimit',
  company_limit: 'companyLimit',
  restricted: 'restricted',
  own_target: 'ownTarget',
} as const satisfies Record<ReportRefusal, string>;

/**
 * The same dialog for a listing, a company or a consultant's profile.
 *
 * Reports about companies and people arrived with migration 317, because the
 * two things a moderator most needs to hear about — a company that is not what
 * it says, somebody wearing another consultant's name — had no door at all.
 *
 * Quick on purpose: one tap on what is wrong, and a line more only if the
 * reader wants to add one. Each reason says in a few words what it covers,
 * so nobody has to decide between "fake" and "scam" in the abstract — and
 * none is chosen for them, because a pre-selected answer is the answer a
 * hurried reader sends.
 *
 * The rules behind it are the database's: an account is required, one report
 * per person per target, and limits that only a pattern of abuse meets. The
 * dialog says which one applied, because "you already told us", "wait a few
 * minutes" and "try tomorrow" each ask for something different.
 */
export function ReportDialog({
  target,
  targetId,
  signedIn,
  returnPath,
  label,
}: {
  target: ReportTarget;
  targetId: string;
  signedIn: boolean;
  /** Where sign-in brings a signed-out reader back to. */
  returnPath: string;
  /** The button's words, which differ per target. */
  label: string;
}) {
  const t = useTranslations('report');
  const tReason = useTranslations('reportReason');
  const tHint = useTranslations('reportHint');
  const tCommon = useTranslations('common');
  const legendId = useId();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!reason) {
      setError(t('chooseReason'));
      return;
    }
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await reach(
        reportTarget({
          target,
          targetId,
          reason,
          detail: String(form.get('detail') ?? ''),
        }),
      );
      if (recoverSession(result)) return;
      if (result.ok) {
        setSent(true);
        setError(null);
        return;
      }
      if (result.error === 'network') {
        // The request never came back. Nothing is claimed; the form stays
        // filled in so sending again is one tap.
        setError(t('network'));
        return;
      }
      const refusal = result.error as ReportRefusal;
      setError(refusal in REFUSAL_COPY ? t(REFUSAL_COPY[refusal]) : tCommon('errorBody'));
    });
  }

  if (sent) {
    return (
      <p role="status" className="flex items-start gap-2 text-sm text-success">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('thanks')}
      </p>
    );
  }

  if (!signedIn) {
    return (
      <Button asChild variant="ghost">
        <a href={`/sign-in?next=${encodeURIComponent(returnPath)}`}>
          <Flag />
          {label}
        </a>
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Flag />
        {label}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        closeLabel={tCommon('close')}
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <h2 className="pe-8 text-lg font-semibold">{label}</h2>

          <fieldset aria-describedby={error ? `${legendId}-error` : undefined}>
            <legend id={legendId} className="mb-2 text-sm font-medium">
              {t('question')}
            </legend>
            <div className="space-y-1.5">
              {REASONS_FOR[target].map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-muted/60 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => {
                      setReason(value);
                      setError(null);
                    }}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{tReason(value)}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">{tHint(value)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label={t('detailLabel')} htmlFor={`${legendId}-detail`} hint={t('detailHint')}>
            <Textarea
              id={`${legendId}-detail`}
              name="detail"
              maxLength={500}
              rows={2}
              className="min-h-16"
              placeholder={t('detailPlaceholder')}
            />
          </Field>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('privacy')}
          </p>

          {error ? (
            <p id={`${legendId}-error`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <SubmitButton disabled={pending}>{t('send')}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
