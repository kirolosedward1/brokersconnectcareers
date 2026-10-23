import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import type { AdminAuditRow, ModerationNoteRow } from '@/lib/supabase/database.types';
import { openDecision } from '~/components/admin/decision-sheet';
import { auditLabel, SectionTitle } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { NotebookPen } from '~/components/ui/lucide';
import { ErrorState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useRecord } from '~/features/admin/record';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/** What a note can be left on, and whose record is drawn: the console's five files. */
export type RecordTarget = 'user' | 'company' | 'job' | 'agent' | 'application';

/**
 * The record of one thing — the website's "Record and notes" on every file:
 * the decisions the admins took on it and the notes they left each other,
 * merged newest first, with an "Add note" lever (addModerationNote, which
 * refuses nobody: a note is for other admins, any words at all). A decision
 * made with a plain edit rather than a lever is marked as such.
 *
 * Given the rows when the screen already has them (the account file reads
 * its own), or read here (useRecord) when it does not.
 */
export function Record({
  targetType,
  targetId,
  audit,
  notes,
}: {
  targetType: RecordTarget;
  targetId: string;
  audit?: AdminAuditRow[];
  notes?: ModerationNoteRow[];
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const given = audit !== undefined && notes !== undefined;
  const read = useRecord(targetType, given ? undefined : targetId);
  const rows = given ? { audit, notes } : read.data;
  const entries = rows
    ? [
        ...rows.audit.map((row) => ({ kind: 'audit' as const, at: row.created_at, row })),
        ...rows.notes.map((row) => ({ kind: 'note' as const, at: row.created_at, row })),
      ].sort((a, b) => b.at.localeCompare(a.at))
    : null;

  return (
    <Card style={{ gap: space[3] }}>
      <SectionTitle>{t('admin.record')}</SectionTitle>
      <View style={{ flexDirection: 'row' }}>
        <Button
          label={t('app.admin.addNote')}
          variant="outline"
          size="sm"
          icon={<NotebookPen size={16} color={colors.foreground} />}
          onPress={() =>
            openDecision({
              lever: { do: 'note', targetType, targetId },
              title: t('app.admin.addNote'),
              reason: 'required',
              // A note is any words at all, as the website takes it; the three-character floor is for reasons.
              reasonMin: 1,
              reasonLabel: t('app.admin.noteLabel'),
              reasonMax: 2000,
              confirmLabel: t('app.admin.addNote'),
            })
          }
        />
      </View>
      {entries === null ? (
        read.isError ? (
          // A record that could not be read is said so: never "nothing recorded".
          <ErrorState error={read.error} onRetry={() => read.refetch()} />
        ) : (
          <Text variant="small" tone="mutedForeground">
            {t('common.loading')}
          </Text>
        )
      ) : entries.length === 0 ? (
        <Text variant="small" tone="mutedForeground">
          {t('admin.trailEmpty')}
        </Text>
      ) : (
        entries.map((entry) =>
          entry.kind === 'audit' ? (
            <AuditEntry key={`a${entry.row.id}`} row={entry.row} />
          ) : (
            <NoteEntry key={`n${entry.row.id}`} row={entry.row} />
          ),
        )
      )}
    </Card>
  );
}

/** One decision on the record: what was done, to what, by whom, and the reason when one was given. */
export function AuditEntry({ row }: { row: AdminAuditRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2, paddingStart: space[3], borderStartWidth: 2, borderStartColor: colors.primary }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] }}>
        <Text variant="small" weight="medium">
          {auditLabel(t, row.action)}
          {row.target_label ? <Text variant="small" tone="mutedForeground">{` — ${row.target_label}`}</Text> : null}
        </Text>
        {row.via === 'direct' ? <Badge variant="outline" label={t('admin.viaDirect')} /> : null}
      </View>
      {row.reason ? <Text variant="small" tone="mutedForeground">{`«${row.reason}»`}</Text> : null}
      <Text variant="caption" tone="mutedForeground">
        {`${row.actor_name ?? t('admin.unknownActor')} · ${formatDateTime(row.created_at, locale)}`}
      </Text>
    </View>
  );
}

/** One note an admin left for the others. */
export function NoteEntry({ row }: { row: ModerationNoteRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2, paddingStart: space[3], borderStartWidth: 2, borderStartColor: colors.warning }}>
      <Text variant="small">{row.body}</Text>
      <Text variant="caption" tone="mutedForeground">
        {`${row.author_name ?? t('admin.unknownActor')} · ${formatDateTime(row.created_at, locale)}`}
      </Text>
    </View>
  );
}
