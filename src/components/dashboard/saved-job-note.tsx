'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { BellRing, NotebookPen, Pencil, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { SubmitButton } from '@/components/ui/submit-button';
import { setSavedJobNote, setSavedJobReminder } from '@/lib/actions/saved-notes';
import { formatDateTime } from '@/lib/format';
import { reach } from '@/lib/reach';
import { cleanSavedNote, SAVED_NOTE_MAX } from '@/lib/saved-note';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * The note and the reminder under a saved listing's card — the same ones the
 * app shows, since both are kept on the bookmark (migration 356).
 *
 * The note reads as a line, and opens into a field to edit; saving an empty
 * one deletes it. The reminder is the app's to set — it is a notification on
 * the phone — so here it is only said, with the way to take it back: the phone
 * lets go of it the next time it reads the saved list.
 */
export function SavedJobNote({
  jobId,
  note: initialNote,
  remindAt: initialRemindAt,
  locale,
}: {
  jobId: string;
  note: string | null;
  remindAt: string | null;
  locale: string;
}) {
  const t = useTranslations('savedNote');
  const [note, setNote] = useState(initialNote);
  const [remindAt, setRemindAt] = useState(initialRemindAt);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  const reasonOf = (code: string) => (code === 'not_saved' ? t('notSaved') : code === 'too_long' ? t('tooLong') : t('failed'));

  function save(text: string) {
    const next = cleanSavedNote(text) || null;
    const before = note;
    setNote(next);
    setEditing(false);
    setError(null);
    startTransition(async () => {
      const result = await reach(setSavedJobNote({ jobId, note: next ?? '' }));
      if (recoverSession(result)) return;
      if (!result.ok) {
        setNote(before);
        setDraft(text);
        setEditing(true);
        setError(reasonOf(result.error));
      }
    });
  }

  function removeReminder() {
    const before = remindAt;
    setRemindAt(null);
    setError(null);
    startTransition(async () => {
      const result = await reach(setSavedJobReminder({ jobId, remindAt: null }));
      if (recoverSession(result)) return;
      if (!result.ok) {
        setRemindAt(before);
        setError(reasonOf(result.error));
      }
    });
  }

  // One that has gone off is done with: the phone has already said it.
  const reminding = remindAt && new Date(remindAt).getTime() > Date.now() ? remindAt : null;
  const fieldId = `saved-note-${jobId}`;

  return (
    <div className="mt-1.5 space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            save(draft);
          }}
        >
          <label htmlFor={fieldId} className="font-medium">
            {t('label')}
          </label>
          <Textarea
            id={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={SAVED_NOTE_MAX}
            placeholder={t('placeholder')}
            aria-describedby={`${fieldId}-private`}
            autoFocus
            className="min-h-20"
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span id={`${fieldId}-private`} className="flex-1">
              {t('private')}
            </span>
            <span className={draft.length >= SAVED_NOTE_MAX ? 'text-warning' : undefined}>
              {t.rich('count', {
                count: draft.length,
                max: SAVED_NOTE_MAX,
                v: (chunks) => <span className="numeral">{chunks}</span>,
              })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton size="sm" disabled={pending || cleanSavedNote(draft) === (note ?? '')}>
              {t('save')}
            </SubmitButton>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(note ?? '');
                setEditing(false);
                setError(null);
              }}
            >
              {t('cancel')}
            </Button>
            {note ? (
              <Button type="button" size="sm" variant="ghost" className="ms-auto text-destructive" disabled={pending} onClick={() => save('')}>
                {t('delete')}
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(note ?? '');
            setEditing(true);
          }}
          aria-label={note ? `${t('prefix')} ${note}. ${t('edit')}` : undefined}
          className="flex w-full items-start gap-2 rounded-md text-start transition-colors hover:text-primary"
        >
          <NotebookPen className={note ? 'mt-0.5 size-4 shrink-0 text-primary' : 'mt-0.5 size-4 shrink-0 text-muted-foreground'} aria-hidden />
          {note ? (
            <span className="min-w-0 flex-1 whitespace-pre-line break-words">
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
      )}

      {reminding ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <BellRing className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="flex-1">{t('reminder', { when: formatDateTime(reminding, locale) })}</span>
          <button
            type="button"
            onClick={removeReminder}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-muted hover:text-destructive"
          >
            <X className="size-3.5" aria-hidden />
            {t('reminderRemove')}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
