'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { SubmitButton } from '@/components/ui/submit-button';
import { AGENT_REPORT_REASONS, COMPANY_REPORT_REASONS, REPORT_REASONS } from '@/lib/taxonomy';
import { reportTarget, type ReportTarget } from '@/lib/actions/reports';
import { reach } from '@/lib/reach';
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
  const t = useTranslations("jobs");
  return (
    <ReportDialog
      target="job"
      targetId={jobId}
      signedIn={signedIn}
      returnPath={`/jobs/${jobSlug}`}
      label={t("report")}
    />
  );
}

const REASONS_FOR: Record<ReportTarget, readonly string[]> = {
  job: REPORT_REASONS,
  company: COMPANY_REPORT_REASONS,
  agent: AGENT_REPORT_REASONS,
};

/**
 * The same dialog for a listing, a company or a consultant's profile.
 *
 * Reports about companies and people arrived with migration 317, because the
 * two things a moderator most needs to hear about — a company that is not what
 * it says, somebody wearing another consultant's name — had no door at all. It
 * is one dialog rather than three so the rules are one set: an account is
 * required, one report per person per target, the daily cap, and the same
 * sentences for each refusal.
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
  const t = useTranslations("jobs");
  const tReason = useTranslations("reportReason");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await reach(reportTarget({
        target,
        targetId,
        reason: form.get("reason"),
        detail: String(form.get("detail") ?? ""),
      }));
      if (recoverSession(result)) return;
      if (result.ok) {
        setSent(true);
        setError(null);
      } else {
        setError(
          result.error === "already_reported"
            ? t("alreadyReported")
            : result.error === "rate_limit"
              ? t("reportRateLimit")
              : tCommon("errorBody"),
        );
      }
    });
  }

  if (sent) {
    return <p className="text-sm text-success">{tCommon("saveSuccess")}</p>;
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
        closeLabel={tCommon("close")}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="text-lg font-semibold">{label}</h2>

          <Field label={t("reportReasonLabel")} htmlFor="reason">
            <Select
              id="reason"
              name="reason"
              required
              defaultValue={REASONS_FOR[target][0]}
            >
              {REASONS_FOR[target].map((reason) => (
                <option key={reason} value={reason}>
                  {tReason(reason)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tCommon("optional")} htmlFor="detail">
            <Textarea id="detail" name="detail" maxLength={1000} />
          </Field>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <SubmitButton disabled={pending}>
              {tCommon("submit")}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
