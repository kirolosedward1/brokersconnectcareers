'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
 *
 * The keyboard behaviour is not decoration. This carried aria-modal="true",
 * which tells assistive technology that everything outside is inert — while
 * focus stayed on the button behind the overlay, Escape did nothing, and the
 * role sat on the backdrop rather than on the box. A keyboard user could open
 * it and not get into it, or get out of it. MobileNav already does all three
 * things properly; this is the same discipline.
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

  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Into the dialog, so the first Tab moves within it rather than through
    // the page behind.
    dialogRef.current?.querySelector<HTMLElement>('select, textarea, button')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      // A real trap: aria-modal promises the rest of the page is unreachable,
      // and without this Tab walks straight out of it.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select, textarea, input:not([type="hidden"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Closing returns focus to what opened it, rather than dropping it on <body>.
  useEffect(() => {
    if (!open) triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

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
      <Button asChild variant="ghost">
        <a href={`/sign-in?next=${encodeURIComponent(`/jobs/${jobSlug}`)}`}>
          <Flag />
          {t('report')}
        </a>
      </Button>
    );
  }

  return (
    <>
      <Button ref={triggerRef} variant="ghost" onClick={() => setOpen(true)}>
        <Flag />
        {t('report')}
      </Button>

      {open ? (
        // The backdrop is a backdrop. The dialog role belongs on the box, and
        // clicking outside closes — the gesture everybody tries first.
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('report')}
            className="w-full max-w-md"
          >
            <form
              onSubmit={onSubmit}
              className="space-y-4 rounded-xl border border-border bg-card p-6"
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
        </div>
      ) : null}
    </>
  );
}
