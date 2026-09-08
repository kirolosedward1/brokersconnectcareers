'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { REPORT_REASONS } from '@/lib/taxonomy';
import { reportJob } from '@/lib/actions/jobs';

/**
 * Reporting needs an account now, so this has a signed-out state: a link to
 * sign in that comes back to the listing, rather than a form that accepts the
 * report and then refuses it.
 */
export function ReportJobDialog({ jobId, signedIn, jobSlug }: { jobId: string; signedIn: boolean; jobSlug: string }) {
  const t = useTranslations('jobs');
  const tReason = useTranslations('reportReason');
  const tAdmin = useTranslations('admin');
  const tCommon = useTranslations('common');

  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await reportJob({
        jobId,
        reason: form.get('reason'),
        detail: String(form.get('detail') ?? ''),
      });
      if (result.ok) {
        setSent(true);
        setError(null);
      } else {
        setError(
          result.error === 'already_reported'
            ? t('alreadyReported')
            : result.error === 'rate_limit'
              ? t('reportRateLimit')
              : tCommon('errorBody'),
        );
      }
    });
  }

  if (sent) {
    return <p className="text-sm text-success">{tCommon('saveSuccess')}</p>;
  }

  if (!signedIn) {
    return (
      <Button asChild variant="ghost" size="sm">
        <a href={`/sign-in?next=${encodeURIComponent(`/jobs/${jobSlug}`)}`}>
          <Flag />
          {t('report')}
        </a>
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Flag />
        {t('report')}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('report')}
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
        >
          <form
            onSubmit={onSubmit}
            className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6"
          >
            <h2 className="text-lg font-semibold">{t('report')}</h2>

            <Field label={tAdmin('reportReason')} htmlFor="reason">
              <Select id="reason" name="reason" required defaultValue="fake_listing">
                {REPORT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {tReason(reason)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={tCommon('optional')} htmlFor="detail">
              <Textarea id="detail" name="detail" maxLength={1000} />
            </Field>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {tCommon('submit')}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
