'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Lock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate, isoDate } from '@/lib/utils';
import { useSessionRecovery } from '@/lib/session-expired';
import { addApplicationNote, deleteApplicationNote } from '@/lib/actions/applications';
import type { ApplicationNoteRow } from '@/lib/supabase/database.types';

/**
 * The company's own notes on an applicant.
 *
 * Deliberately unlike the decision note directly above it. That one is written
 * *to* the candidate — it is how a rejection says why, and the candidate reads
 * it on their dashboard. This one the candidate cannot read at all, and the
 * padlock says so on every render rather than in a hint somebody reads once.
 *
 * A list rather than a field, because "called, no answer" then "spoke to them,
 * wants 12k" then "offered" is a conversation with itself, not one box
 * overwritten three times. There is no edit: a note that can be rewritten
 * after the fact is worth less than one that cannot, which is the same reason
 * the application's own event log has no update policy.
 */
export function ApplicantNotes({
  applicationId,
  notes: fromServer,
  authors,
  locale,
  viewerId,
}: {
  applicationId: string;
  notes: ApplicationNoteRow[];
  /** Author id → display name, resolved once by the page rather than per card. */
  authors: Record<string, string>;
  locale: string;
  viewerId: string;
}) {
  const t = useTranslations('employer');
  const tCommon = useTranslations('common');
  const router = useRouter();
  /*
    The server's list, plus anything written since.

    `router.refresh()` alone was not enough: the note was in the database and
    the card still showed nothing until a full reload. Rather than chase the
    refresh, the card renders the row the action returns — which is the row the
    database wrote, timestamp and all, so nothing here is invented. The refresh
    still runs, for everything else on the page that a new note changes.
  */
  const [added, setAdded] = useState<ApplicationNoteRow[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);

  /*
    Deduplicated on the way out, because both halves are eventually true.

    Once the refresh lands, the server's list contains the note this component
    is also holding, and concatenating them would show it twice — briefly, and
    only for whoever wrote it, which is the sort of thing that never survives
    to a bug report and just makes the page feel unreliable.
  */
  const knownToServer = new Set(fromServer.map((note) => note.id));
  const notes = [...fromServer, ...added.filter((note) => !knownToServer.has(note.id))].filter(
    (note) => !removed.includes(note.id),
  );

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function add() {
    const body = draft.trim();
    if (!body) return;

    startTransition(async () => {
      setError(null);
      const result = await addApplicationNote({ applicationId, body });
      if (recoverSession(result)) return;

      if (!result.ok) {
        setError(tCommon('errorBody'));
        return;
      }

      // Cleared only once the server has it. A box that empties on submit and
      // then fails has taken somebody's sentence away.
      setDraft('');
      if (result.data?.note) setAdded((current) => [...current, result.data!.note]);
      router.refresh();
    });
  }

  function remove(id: number) {
    startTransition(async () => {
      setError(null);
      const result = await deleteApplicationNote(id);
      if (recoverSession(result)) return;
      if (!result.ok) {
        setError(tCommon('errorBody'));
        return;
      }
      setRemoved((current) => [...current, id]);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Lock className="size-3.5" aria-hidden />
        {t('notesTitle')}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('notesHint')}</p>

      {notes.length ? (
        <ul className="mt-3 space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg bg-muted/60 p-2.5 text-sm">
              <p className="leading-relaxed">{note.body}</p>

              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {/* The author's account may be closed — the note outlives it,
                    which is why author_id is `on delete set null`. */}
                <span>{note.author_id ? (authors[note.author_id] ?? t('notesFormerColleague')) : t('notesFormerColleague')}</span>
                <span aria-hidden>·</span>
                <time dateTime={isoDate(note.created_at)}>{formatDate(note.created_at, locale)}</time>

                {note.author_id === viewerId ? (
                  <button
                    type="button"
                    onClick={() => remove(note.id)}
                    disabled={pending}
                    className="ms-auto inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-60"
                  >
                    <Trash2 className="size-3" aria-hidden />
                    {tCommon('delete')}
                  </button>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-start gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          rows={2}
          placeholder={t('notesPlaceholder')}
          aria-label={t('notesTitle')}
          className="min-w-0 flex-1 rounded-lg border border-input bg-background p-2.5 text-sm shadow-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !draft.trim()}
          onClick={add}
        >
          {t('notesAdd')}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
