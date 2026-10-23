'use client';

import { useId, useState, useTransition } from 'react';
import { Lock, NotebookPen, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { setSavedJobNote } from '@/lib/actions/jobs';
import { reach } from '@/lib/reach';
import { cleanNote, NOTE_MAX } from '@/lib/saved-note';
import { useSessionRecovery } from '@/lib/session-expired';
import { cn } from '@/lib/utils';

/**
 * The candidate's own line under a saved listing — "spoke to Mona, interview
 * Sunday" — kept with the bookmark (migration 353) and shown here and in the
 * app alike, in the same words (the `savedNotes` catalogue). A row to read
 * and press; pressed, a small form in its place: the field, counted as they
 * type, Save, Cancel, and Delete once there is a note to delete. Only the
 * person who saved the listing sees it.
 */
export function SavedJobNote({ jobId, initialNote }: { jobId: string; initialNote: string | null }) {
  const t = useTranslations('savedNotes');
  const tCommon = useTranslations('common');
  const fieldId = useId();
  const recoverSession = useSessionRecovery();
  const [note, setNote] = useState<string | null>(initialNote);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const clean = cleanNote(draft);
  const changed = clean !== (note ?? '');

  const write = (next: string | null) => {
    setError(null);
    startTransition(async () => {
      const result = await reach(setSavedJobNote({ jobId, note: next }));
      if (recoverSession(result)) return;
      if (!result.ok) {
        setError(tCommon('errorBody'));
        return;
      }
      setNote(result.data?.note ?? null);
      setEditing(false);
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(note ?? '');
          setEditing(true);
        }}
        aria-label={note ? t('edit') : t('add')}
        className={cn(
          'mt-2 flex w-full items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-start text-sm',
          'transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        )}
      >
        <NotebookPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {note ? (
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            <span className="font-semibold">{t('prefix')} </span>
            {note}
          </span>
        ) : (
          <span className="flex-1 font-medium text-muted-foreground">{t('add')}</span>
        )}
        {note ? (
          <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) write(clean || null);
      }}
      className="mt-2 space-y-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      <label htmlFor={fieldId} className="block text-sm font-medium">
        {t('title')}
      </label>
      <textarea
        id={fieldId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={NOTE_MAX}
        rows={3}
        autoFocus
        placeholder={t('placeholder')}
        aria-describedby={`${fieldId}-hint`}
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div id={`${fieldId}-hint`} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Lock className="size-3 shrink-0" aria-hidden />
          {t('private')}
        </span>
        <span aria-label={t('countSpoken', { count: draft.length, max: NOTE_MAX })}>
          {t.rich('count', { count: draft.length, max: NOTE_MAX, v: (chunks) => <span dir="ltr">{chunks}</span> })}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !changed}>
          {pending ? tCommon('loading') : tCommon('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
          {tCommon('cancel')}
        </Button>
        {note ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} className="ms-auto text-destructive" onClick={() => write(null)}>
            {t('delete')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
