import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import { MapPin } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import type { Branch } from '~/features/employer/branches';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/** Where else the company is (Phase B 07b): each branch and its district, on the company's page. */
export function BranchList({ branches }: { branches: Branch[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="headline" weight="semibold" accessibilityRole="header">
        {t('app.branches.publicTitle')}
      </Text>
      {branches.map((branch) => (
        <View key={branch.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
          <MapPin size={15} color={colors.mutedForeground} style={{ marginTop: 3 }} />
          <Text variant="small" style={{ flex: 1 }}>
            {[localized(locale, branch.name_ar, branch.name_en), branch.district ? localized(locale, branch.district.name_ar, branch.district.name_en) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ))}
    </View>
  );
}
