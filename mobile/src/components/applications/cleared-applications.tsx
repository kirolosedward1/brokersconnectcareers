import { StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { ApplicationRecordRow } from '@/lib/supabase/database.types';
import { Text } from '~/components/ui/text';
import { useApplicationRecords } from '~/features/applications/records';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

/**
 * Applications a company cleared, or took with it when it closed (Phase B
 * 07c): the listing, the company, when it was sent and how it stood. Nothing
 * when there are none.
 */
export function ClearedApplications() {
  const t = useTranslations();
  const { colors } = useTheme();
  const records = useApplicationRecords().data ?? [];
  if (!records.length) return null;
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="small" weight="semibold" tone="mutedForeground" accessibilityRole="header">
        {t('app.closure.recordsHeading')}
      </Text>
      <Text variant="caption" tone="mutedForeground">
        {t('app.closure.recordsBody')}
      </Text>
      <View style={{ ...corner('xl'), borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' }}>
        {records.map((record, index) => (
          <RecordRow key={record.id} record={record} first={index === 0} />
        ))}
      </View>
    </View>
  );
}

export function RecordRow({ record, first }: { record: ApplicationRecordRow; first: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <View
      style={{
        padding: space[4],
        gap: space[1],
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth * 2,
        borderTopColor: colors.border,
      }}
    >
      <Text weight="medium">{localized(locale, record.job_title_ar, record.job_title_en)}</Text>
      <Text variant="small" tone="mutedForeground">
        {`${localized(locale, record.company_name_ar, record.company_name_en)} · ${t(`applicationStatus.${record.last_status}`)}`}
      </Text>
      <Text variant="caption" tone="mutedForeground">
        {t(record.reason === 'company_deleted' ? 'app.closure.recordDeleted' : 'app.closure.recordPurged', {
          date: formatDate(record.applied_at, locale),
        })}
      </Text>
    </View>
  );
}
