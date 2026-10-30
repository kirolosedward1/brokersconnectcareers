import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { localized } from '@/lib/locale';
import { Button } from '~/components/ui/button';
import { History, Trash2, UsersRound } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useCandidateNoteActions, type CandidateNote, type EarlierApplication } from '~/features/employer/candidate-file';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * What the company knows of the person (migration 375, the CandidateHistory
 * board), on each of their applications: «تقدّم من قبل» — how many times,
 * and how the latest ended, with the list a tap away — and the notes about
 * them the whole company keeps (decided), which the candidate never reads.
 */
export function CandidateFile({
  applicationId,
  notes,
  history,
  authors,
  viewerId,
  readOnly = false,
}: {
  applicationId: string;
  notes: CandidateNote[];
  history: EarlierApplication[];
  authors: Record<string, string>;
  viewerId: string | null;
  readOnly?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { add, remove } = useCandidateNoteActions();
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const latest = history[0];

  const save = () => {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    add.mutate({ applicationId, body }, { onSuccess: () => setDraft(''), onError: () => setError(t('common.errorBody')) });
  };

  return (
    <View style={{ gap: space[3] }}>
      {latest ? (
        <View style={{ gap: space[1.5], padding: space[3], ...corner('lg'), backgroundColor: colors.muted }} testID="candidate-history">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <History size={16} color={colors.mutedForeground} />
            <Text variant="small" weight="semibold" style={{ flex: 1 }}>
              {t.markup('app.candidateFile.history', { count: history.length, ...markupTags })}
            </Text>
          </View>
          <Text variant="caption" tone="mutedForeground">
            {t('app.candidateFile.historyLast', {
              job: localized(locale, latest.job_title_ar, latest.job_title_en),
              status: t(`applicationStatus.${latest.status}`),
            })}
          </Text>
          {history.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showHistory }}
              onPress={() => setShowHistory((open) => !open)}
              style={{ minHeight: hitTarget - 8, justifyContent: 'center' }}
            >
              <Text variant="caption" weight="medium" tone="primary">
                {showHistory ? t('app.candidateFile.historyHide') : t('app.candidateFile.historyShow')}
              </Text>
            </Pressable>
          ) : null}
          {showHistory
            ? history.map((row) => (
                <Text key={row.application_id} variant="caption">
                  {`${localized(locale, row.job_title_ar, row.job_title_en)} · ${t(`applicationStatus.${row.status}`)} · ${formatDate(row.created_at, locale)}`}
                </Text>
              ))
            : null}
        </View>
      ) : null}

      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <UsersRound size={16} color={colors.mutedForeground} />
          <Text variant="small" weight="semibold" accessibilityRole="header">
            {t('app.candidateFile.notesTitle')}
          </Text>
        </View>
        <Text variant="caption" tone="mutedForeground">
          {t('app.candidateFile.notesHint')}
        </Text>
        {notes.map((note) => (
          <View key={note.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="small">{note.body}</Text>
              <Text variant="caption" tone="mutedForeground">
                {t('app.candidateFile.notesBy', {
                  name: (note.author_id && authors[note.author_id]) || t('app.candidateFile.formerColleague'),
                  date: formatDate(note.created_at, locale),
                })}
              </Text>
            </View>
            {!readOnly && note.author_id === viewerId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('app.candidateFile.notesRemove')}
                onPress={() => remove.mutate(note.id, { onError: () => setError(t('common.errorBody')) })}
                hitSlop={8}
                style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
              >
                <Trash2 size={16} color={colors.destructive} />
              </Pressable>
            ) : null}
          </View>
        ))}
        {readOnly ? null : (
          <>
            <TextField
              value={draft}
              onChangeText={setDraft}
              accessibilityLabel={t('app.candidateFile.notesField')}
              placeholder={t('app.candidateFile.notesField')}
              multiline
              maxLength={2000}
              style={{ minHeight: 56, textAlignVertical: 'top' }}
            />
            <View style={{ alignItems: 'flex-start' }}>
              <Button label={t('app.candidateFile.notesAdd')} variant="outline" size="sm" loading={add.isPending} disabled={!draft.trim()} onPress={save} />
            </View>
          </>
        )}
        {error ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
