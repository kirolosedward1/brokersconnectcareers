import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { ChevronDown, ChevronUp, Lock, Trash2 } from '~/components/ui/lucide';
import { formatDate, formatNumber } from '@/lib/format';
import type { ApplicationNoteRow } from '@/lib/supabase/database.types';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useAddNote, useDeleteNote } from '~/features/employer/applicants';
import { ApiError } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * The company's own notes on an applicant — the website's ApplicantNotes.
 * Unlike the decision note above it, the candidate cannot read these, and
 * the padlock says so every time. A list, not a field: a note is never
 * rewritten, only added, or taken back by whoever wrote it. Closed until
 * there is something in it.
 */
export function ApplicantNotes({
  applicationId,
  notes,
  authors,
  viewerId,
}: {
  applicationId: string;
  /** Undefined until the company's notes have been read. */
  notes: ApplicationNoteRow[] | undefined;
  authors: Record<string, string>;
  viewerId: string | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const add = useAddNote();
  const remove = useDeleteNote();
  const shown = notes ?? [];
  // Open while there are notes, until somebody says otherwise — they arrive after the card does.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? shown.length > 0;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    add.mutate(
      // The newest note shown, so a lost answer can be told from a note that never went in; none while unread.
      { applicationId, body, after: notes ? notes.reduce((newest, note) => Math.max(newest, note.id), 0) : null },
      {
        // Cleared only once the server has it: a box that empties and then fails has taken a sentence away.
        onSuccess: () => setDraft(''),
        onError: (failure) =>
          setError(failure instanceof ApiError && failure.status === 0 ? t('app.offline.body') : t('common.errorBody')),
      },
    );
  };

  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View style={{ gap: space[2], paddingTop: space[2], borderTopWidth: 1, borderTopColor: colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={t('employer.notesHint')}
        onPress={() => setChosen(!open)}
        hitSlop={{ top: 4, bottom: 4 }}
        style={{ minHeight: hitTarget - 8, flexDirection: 'row', alignItems: 'center', gap: space[1] }}
      >
        <Lock size={14} color={colors.mutedForeground} />
        <Text variant="small" weight="medium" tone="mutedForeground">
          {t('employer.notesTitle')}
        </Text>
        {shown.length ? (
          <View style={{ minWidth: 24, paddingHorizontal: space[2], paddingVertical: 1, ...corner('full'), backgroundColor: colors.muted, alignItems: 'center' }}>
            <Text variant="caption" weight="medium">
              {formatNumber(shown.length, locale)}
            </Text>
          </View>
        ) : null}
        <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }} numberOfLines={1}>
          {`— ${t('employer.notesHint')}`}
        </Text>
        <Chevron size={16} color={colors.mutedForeground} />
      </Pressable>

      {open ? (
        <View style={{ gap: space[2] }}>
          {shown.map((note) => (
            <View key={note.id} style={{ gap: 2, paddingStart: space[3], borderStartWidth: 2, borderStartColor: colors.border }}>
              <Text variant="small">{note.body}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }}>
                  {`${note.author_id ? (authors[note.author_id] ?? t('employer.notesFormerColleague')) : t('employer.notesFormerColleague')} · ${formatDate(note.created_at, locale)}`}
                </Text>
                {note.author_id && note.author_id === viewerId ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('common.delete')}: ${note.body.slice(0, 40)}`}
                    disabled={remove.isPending}
                    onPress={() =>
                      remove.mutate(note.id, {
                        onError: () => setError(t('common.errorBody')),
                      })
                    }
                    hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                    style={{ minHeight: hitTarget - 12, flexDirection: 'row', alignItems: 'center', gap: 2 }}
                  >
                    <Trash2 size={12} color={colors.destructive} />
                    <Text variant="caption" tone="destructive">
                      {t('common.delete')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}

          <TextField
            value={draft}
            onChangeText={setDraft}
            accessibilityLabel={t('employer.notesTitle')}
            placeholder={t('employer.notesPlaceholder')}
            multiline
            maxLength={2000}
            style={{ minHeight: 56, paddingVertical: space[2], textAlignVertical: 'top' }}
          />
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={t('employer.notesAdd')}
              variant="outline"
              size="sm"
              loading={add.isPending}
              disabled={!draft.trim()}
              onPress={save}
            />
          </View>
          {error ? (
            <Text variant="small" tone="destructive" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
