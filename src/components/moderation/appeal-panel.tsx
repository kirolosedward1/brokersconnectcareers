'use client';

import { useId, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MessageSquareReply } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { submitAppeal, type AppealRefusal } from '@/lib/actions/appeals';
import type { ActionResult } from '@/lib/actions/jobs';
import type { AppealState, AppealSubjectType } from '@/lib/supabase/database.types';
import { useSessionRecovery } from '@/lib/session-expired';
import { formatDate } from '@/lib/utils';

const REFUSAL_COPY = {
  message_required: 'messageRequired',
  not_appealable: 'notAppealable',
  appeal_open: 'alreadyOpen',
  appeal_limit: 'limit',
  appeal_too_soon: 'tooSoon',
  rate_limit: 'rateLimit',
  company_suspended: 'companySuspended',
  unavailable: 'unavailable',
} as const satisfies Record<AppealRefusal, string>;

/**
 * "Ask for a review", under the decision it is about.
 *
 * Not a ticket system: one message in, one answer out, and the answer arrives
 * as a notification. So the panel only ever shows one of three things — the
 * form (when the database says this account may appeal), the appeal already
 * waiting, or the last answer — and nothing at all when appealing is not
 * possible, rather than a button whose only outcome is a refusal.
 */
export function AppealPanel({
  subjectType,
  subjectId,
  state,
}: {
  subjectType: AppealSubjectType;
  subjectId: string;
  state: AppealState | null;
}) {
  const t = useTranslations('appeals');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const fieldId = useId();
  const recoverSession = useSessionRecovery();

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!state) return null;

  const tooShort = message.trim().length < 10;

  function send() {
    if (pending) return;
    if (tooShort) {
      setError(t('messageRequired'));
      return;
    }
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = await submitAppeal({ subjectType, subjectId, message: message.trim() });
      } catch {
        // Never came back: nothing is claimed, and the words stay in the box.
        setError(t('network'));
        return;
      }
      if (recoverSession(result)) return;
      if (result.ok) {
        setSent(true);
        setError(null);
        router.refresh();
        return;
      }
      const refusal = result.error as AppealRefusal;
      setError(refusal in REFUSAL_COPY ? t(REFUSAL_COPY[refusal]) : tCommon('errorBody'));
      if (refusal === 'appeal_open') router.refresh();
    });
  }

  if (sent) {
    return (
      <p role="status" className="mt-3 text-sm text-success">
        {t('sent')}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {state.open ? (
        <p className="text-sm">{t('waiting', { date: formatDate(state.open.created_at, locale) })}</p>
      ) : null}

      {!state.open && state.last?.status === 'upheld' ? (
        <div className="border-s-2 border-border ps-3 text-sm">
          <p>{t('stands', { date: formatDate(state.last.decided_at, locale) })}</p>
          {state.last.note ? <p className="mt-1 text-muted-foreground">«{state.last.note}»</p> : null}
        </div>
      ) : null}

      {state.appealable && !open ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <MessageSquareReply aria-hidden />
          {t('ask')}
        </Button>
      ) : null}

      {state.appealable && open ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
          <Field label={t('label')} htmlFor={fieldId} hint={t('hint')} error={error ?? undefined}>
            <Textarea
              id={fieldId}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={1000}
              rows={3}
              className="min-h-20"
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" size="sm" onClick={send} disabled={pending} aria-busy={pending}>
              {pending ? tCommon('loading') : t('send')}
            </Button>
          </div>
        </div>
      ) : null}

      {error && !open ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
