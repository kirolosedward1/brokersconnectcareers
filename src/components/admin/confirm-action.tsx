'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import {
  deleteTaxonomy,
  moderateJob,
  moderateReports,
  reviewCompany,
  setAccountApproval,
  setAgentRestriction,
  setCompanySuspension,
  setJobFeatured,
  type JobModerationAction,
} from '@/lib/actions/admin';
import type { ActionResult } from '@/lib/actions/jobs';
import { isAdminErrorCode } from '@/lib/admin/errors';
import { announceDone } from '@/components/admin/console-toaster';
import type { ApprovalStatus, TaxonomyKind } from '@/lib/supabase/database.types';

/**
 * What a button does, as data.
 *
 * A server page cannot hand a client component a function bound to an id, so
 * it describes the lever instead and this side picks the action. Every lever
 * in the console is one of these, which is what makes the rules below — a
 * confirmation, a reason where one is owed, one submission at a time, success
 * only after the database said yes — true everywhere at once rather than
 * wherever somebody remembered.
 */
export type AdminLever =
  | { do: 'job'; jobId: string; action: JobModerationAction }
  | { do: 'feature'; jobId: string; featured: boolean }
  | { do: 'company'; companyId: string; decision: 'verify' | 'reject' | 'request_changes' | 'revoke' }
  | { do: 'suspendCompany'; companyId: string; suspend: boolean }
  | { do: 'approval'; userId: string; status: ApprovalStatus }
  | { do: 'restrictAgent'; agentId: string; restrict: boolean }
  | {
      do: 'reports';
      targetType: 'job' | 'company' | 'agent';
      targetId: string;
      status: 'investigating' | 'resolved' | 'dismissed';
      takeAction?: boolean;
    }
  | { do: 'deleteTaxonomy'; kind: TaxonomyKind; id: number };

function pull(lever: AdminLever, reason: string): Promise<ActionResult<unknown>> {
  switch (lever.do) {
    case 'job':
      return moderateJob({ jobId: lever.jobId, action: lever.action, reason });
    case 'feature':
      return setJobFeatured({ jobId: lever.jobId, featured: lever.featured });
    case 'company':
      return reviewCompany({ companyId: lever.companyId, decision: lever.decision, note: reason });
    case 'suspendCompany':
      return setCompanySuspension({ companyId: lever.companyId, suspend: lever.suspend, reason });
    case 'approval':
      return setAccountApproval({ userId: lever.userId, status: lever.status, note: reason });
    case 'restrictAgent':
      return setAgentRestriction({ agentId: lever.agentId, restrict: lever.restrict, reason });
    case 'reports':
      return moderateReports({
        targetType: lever.targetType,
        targetId: lever.targetId,
        status: lever.status,
        note: reason,
        takeAction: lever.takeAction ?? false,
      });
    case 'deleteTaxonomy':
      return deleteTaxonomy({ kind: lever.kind, id: lever.id });
  }
}

/**
 * A lever, its confirmation, and its outcome.
 *
 * `reason` decides the dialog: `required` will not submit without three
 * characters (the database refuses it anyway — this only saves the round
 * trip), `optional` offers the box, `none` asks only for the confirmation.
 * Nothing in the console acts on one click; even an approval is a
 * confirmation, because it emails somebody and cannot be un-sent.
 *
 * The success line appears only after the action returned ok, which is only
 * after the change and its audit record committed together.
 */
export function ConfirmAction({
  lever,
  label,
  title,
  body,
  confirmLabel,
  reason = 'none',
  reasonLabel,
  variant = 'outline',
  icon,
  size = 'sm',
  className,
}: {
  lever: AdminLever;
  label: string;
  title: string;
  /** What will happen, in a sentence the admin reads before confirming. */
  body?: string;
  confirmLabel?: string;
  reason?: 'required' | 'optional' | 'none';
  reasonLabel?: string;
  variant?: ButtonProps['variant'];
  icon?: React.ReactNode;
  size?: ButtonProps['size'];
  className?: string;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const tooShort = reason === 'required' && text.trim().length < 3;

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function confirm() {
    if (pending || tooShort) return;
    startTransition(async () => {
      setError(null);
      let result: ActionResult<unknown>;
      try {
        result = await pull(lever, text.trim());
      } catch {
        // The request never came back: offline, or the deployment moved under
        // it. Nothing is claimed either way — the page is re-read to find out.
        setError(t('errors.network'));
        router.refresh();
        return;
      }

      if (!result.ok) {
        setError(isAdminErrorCode(result.error) ? t(`errors.${result.error}`) : t('errors.unknown'));
        // The most common failure is that somebody else already moved it, and
        // the fix for that is the current state on screen.
        if (result.error === 'invalid_transition' || result.error === 'not_found' || result.error === 'no_change') {
          router.refresh();
        }
        return;
      }

      setOpen(false);
      setText('');
      setDone(true);
      announceDone(t('doneWhat', { what: title }));
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
      >
        {icon}
        {label}
      </Button>

      {done ? (
        <span role="status" className="text-xs text-success">
          {t('done')}
        </span>
      ) : null}

      <Dialog open={open} onClose={close} label={title} closeLabel={tCommon('close')}>
        <div className="space-y-4">
          <div className="pe-8">
            <h2 className="text-base font-semibold">{title}</h2>
            {body ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p> : null}
          </div>

          {reason !== 'none' ? (
            <Field
              label={`${reasonLabel ?? t('reasonLabel')}${reason === 'optional' ? ` (${tCommon('optional')})` : ''}`}
              htmlFor={fieldId}
            >
              <Textarea
                id={fieldId}
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={500}
                rows={3}
                className="min-h-20"
                aria-required={reason === 'required'}
              />
            </Field>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-lg bg-destructive-muted px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant={variant === 'destructive' ? 'destructive' : variant === 'success' ? 'success' : 'default'}
              onClick={confirm}
              disabled={pending || tooShort}
              aria-busy={pending}
            >
              {pending ? tCommon('loading') : (confirmLabel ?? label)}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
