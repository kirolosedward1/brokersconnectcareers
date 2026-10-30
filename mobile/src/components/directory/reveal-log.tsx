import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import { localized } from '@/lib/locale';
import { SettingsGroup } from '~/components/ui/settings-list';
import { Text } from '~/components/ui/text';
import { useMyRevealLog, type RevealEntry } from '~/features/directory/reveals';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * Which companies revealed the consultant's number, and when (Phase B 10):
 * the company's name only, never who on its team pressed. Nothing at all
 * when the server cannot say (before migration 381).
 */
export function RevealLog() {
  const log = useMyRevealLog(true).data;
  if (!log) return null;
  return <RevealLogList entries={log} />;
}

export function RevealLogList({ entries }: { entries: RevealEntry[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <SettingsGroup title={t('app.privacy.revealLog')} footer={t('app.privacy.revealLogHint')}>
      {entries.length ? (
        entries.map((entry, index) => (
          <View
            key={`${entry.revealedAt}-${index}`}
            style={{
              paddingHorizontal: space[4],
              paddingVertical: space[3],
              gap: 2,
              borderTopWidth: index ? 1 : 0,
              borderTopColor: colors.border,
            }}
          >
            <Text weight="medium">
              {entry.companyNameAr ? localized(locale, entry.companyNameAr, entry.companyNameEn) : t('app.privacy.revealLogGone')}
            </Text>
            <Text variant="caption" tone="mutedForeground">
              {formatDateTime(entry.revealedAt, locale)}
            </Text>
          </View>
        ))
      ) : (
        <Text variant="small" tone="mutedForeground" style={{ padding: space[4] }}>
          {t('app.privacy.revealLogEmpty')}
        </Text>
      )}
    </SettingsGroup>
  );
}
