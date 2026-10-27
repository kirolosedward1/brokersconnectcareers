'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRouter as useIntlRouter } from '@/i18n/navigation';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import {
  deleteTaxonomy,
  endSessions,
  moderateJob,
  moderateReports,
  reviewCompany,
  setAccountApproval,
  setAgentRestriction,
  setCompanySuspension,
  setJobFeatured,
  setSignInBlock,
  setTestFlag,
  setUserRole,
  type JobModerationAction,
} from '@/lib/actions/admin';
import { closeReports, decideAppeal, setReportingRestriction } from '@/lib/actions/moderation';
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
  /** `version`: the listing as the page showed it; an edit since is refused, not approved unseen. */
  | { do: 'job'; jobId: string; action: JobModerationAction; version?: number }
  | { do: 'feature'; jobId: string; featured: boolean }
  | { do: 'company'; companyId: string; decision: 'verify' | 'reject' | 'request_changes' | 'revoke'; version?: number }
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
  | { do: 'deleteTaxonomy'; kind: TaxonomyKind; id: number }
  // Moderation (migrations 326 and 328).
  | {
      do: 'closeReports';
      ids: string[];
      status: 'investigating' | 'resolved' | 'dismissed';
      abusive?: boolean;
    }
  | { do: 'reporting'; userId: string; restrict: boolean }
  | { do: 'appeal'; appealId: string; overturn: boolean }
  // The account itself (migration 355): its role, its door, its devices.
  | { do: 'role'; userId: string; role: 'candidate' | 'employer' | 'admin' }
  | { do: 'signInBlock'; userId: string; block: boolean }
  | { do: 'sessions'; userId: string }
  | { do: 'testFlag'; userId?: string; companyId?: string; test: boolean };

function pull(lever: AdminLever, reason: string): Promise<ActionResult<unknown>> {
  switch (lever.do) {
    case 'job':
      return moderateJob({ jobId: lever.jobId, action: lever.action, reason, version: lever.version });
    case 'feature':
      return setJobFeatured({ jobId: lever.jobId, featured: lever.featured });
    case 'company':
      return reviewCompany({ companyId: lever.companyId, decision: lever.decision, note: reason, version: lever.version });
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
    case 'closeReports':
      return closeReports({ ids: lever.ids, status: lever.status, note: reason, abusive: lever.abusive ?? false });
    case 'reporting':
      return setReportingRestriction({ userId: lever.userId, restrict: lever.restrict, reason });
    case 'appeal':
      return decideAppeal({ appealId: lever.appealId, overturn: lever.overturn, note: reason });
    case 'role':
      return setUserRole({ userId: lever.userId, role: lever.role, reason });
    case 'signInBlock':
      return setSignInBlock({ userId: lever.userId, block: lever.block, reason });
    case 'sessions':
      return endSessions({ userId: lever.userId, reason });
    case 'testFlag':
      return setTestFlag({ userId: lever.userId, companyId: lever.companyId, test: lever.test, reason });
  }
}

/**
 * How many devices an action signed out, when it says. Blocking sign-in and
 * ending sessions both answer with the count, and "signed out of 3 devices"
 * is the one thing the admin who pulled either wants to hear; the other
 * levers answer with nothing, or with something else, and get the plain
 * confirmation.
 */
function sessionsEndedOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null || !('sessionsEnded' in data)) return null;
  const count = (data as { sessionsEnded: unknown }).sessionsEnded;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

/**
 * A lever, its confirmation, and its outcome.
 *
 * `reason` decides the dialog: `required` and `optional` both offer the box
 * and both submit with it empty — a reason is optional everywhere, and the
 * label already says so. `none` asks only for the confirmation. Nothing in
 * the console acts on one click; even an approval is a confirmation, because
 * it emails somebody and cannot be un-sent.
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
  chrome = 'default',
  thenGo,
  toast,
  listenFor,
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
  /** `icon` is a table button with the label as its tooltip. `menu` is a row in the ⋯ menu. */
  chrome?: 'default' | 'icon' | 'menu';
  /** After a yes, go here instead of only re-reading this page. */
  thenGo?: string;
  /** The line the toast speaks when `thenGo` is set, or when the queue has nothing left. */
  toast?: string;
  /** A window event that opens this confirmation. Used by the review-page A key. */
  listenFor?: string;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const go = useIntlRouter();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!listenFor) return;
    const open = () => {
      setDone(false);
      setOpen(true);
    };
    window.addEventListener(listenFor, open);
    return () => window.removeEventListener(listenFor, open);
  }, [listenFor]);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function confirm() {
    if (pending) return;
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
      // Only a lever that ends sessions says how many: allowing sign-in again
      // answers with the same shape and a count of none, which is no news.
      const ended = lever.do === 'sessions' || (lever.do === 'signInBlock' && lever.block) ? sessionsEndedOf(result.data) : null;
      if (toast) {
        announceDone(toast);
        if (thenGo) go.push(thenGo);
        else router.refresh();
        return;
      }
      announceDone(
        ended === null
          ? t('doneWhat', { what: title })
          : `${t('doneWhat', { what: title })} · ${t('sessionsEnded', { count: ended })}`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={chrome === 'menu' ? 'ghost' : variant}
        size={chrome === 'icon' ? 'icon' : size}
        title={chrome === 'icon' ? label : undefined}
        aria-label={chrome === 'icon' ? label : undefined}
        className={
          chrome === 'icon'
            ? `size-8 ${className ?? ''}`
            : chrome === 'menu'
              ? `min-h-11 w-full justify-start px-3 ${className ?? ''}`
              : className
        }
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
      >
        {icon}
        {chrome === 'icon' ? <span className="sr-only">{label}</span> : label}
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
              label={reasonLabel ?? t('reasonLabel')}
              htmlFor={fieldId}
            >
              <Textarea
                id={fieldId}
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={500}
                rows={3}
                className="min-h-20"
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
              disabled={pending}
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
