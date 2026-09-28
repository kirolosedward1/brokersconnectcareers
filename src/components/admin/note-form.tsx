'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { SubmitButton } from '@/components/ui/submit-button';
import { Textarea } from '@/components/ui/field';
import { addModerationNote } from '@/lib/actions/admin';
import { isAdminErrorCode } from '@/lib/admin/errors';
import type { AuditTargetType } from '@/lib/supabase/database.types';

/**
 * Somewhere to write down what the investigation found — "called them,
 * waiting on the register" — that the next admin will read before acting.
 * Internal: nobody but an admin can read a note, and a note cannot be edited
 * or deleted once written.
 */
export function NoteForm({ targetType, targetId }: { targetType: AuditTargetType; targetId: string }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const fieldId = useId();

  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !body.trim()) return;
    startTransition(async () => {
      setError(null);
      try {
        const result = await addModerationNote({ targetType, targetId, body: body.trim() });
        if (!result.ok) {
          setError(isAdminErrorCode(result.error) ? t(`errors.${result.error}`) : t('errors.unknown'));
          return;
        }
        setBody('');
        router.refresh();
      } catch {
        setError(t('errors.network'));
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={fieldId} className="sr-only">
        {t('addNote')}
      </label>
      <Textarea
        id={fieldId}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t('notePlaceholder')}
        maxLength={2000}
        rows={2}
        className="min-h-16"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('noteInternal')}</p>
        <SubmitButton size="sm" disabled={pending || !body.trim()}>
          {pending ? '…' : t('addNote')}
        </SubmitButton>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
