import { Pressable, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Check, Eye } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * Whether the candidate reads the reason (decided in the v1.1 Phase B
 * review): the employer's tick, on one applicant's card and on a bulk
 * decline alike. On, the reason is the candidate's to read; off, the website
 * keeps it as the team's note. The line under it says which.
 */
export function ReasonTick({ shared, onChange, testID }: { shared: boolean; onChange: (shared: boolean) => void; testID?: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const hint = shared ? t('employer.decisionNoteHint') : t('app.applicants.reasonPrivateHint');
  return (
    <View style={{ gap: space[1] }}>
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: shared }}
        accessibilityHint={hint}
        onPress={() => onChange(!shared)}
        hitSlop={6}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: hitTarget }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            ...corner('md'),
            borderWidth: 1.5,
            borderColor: shared ? colors.primary : colors.input,
            backgroundColor: shared ? colors.primary : colors.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {shared ? <Check size={14} color={colors.primaryForeground} /> : null}
        </View>
        <Eye size={14} color={shared ? colors.primary : colors.mutedForeground} accessible={false} />
        <Text variant="small" tone={shared ? 'primary' : 'mutedForeground'} weight="medium">
          {t('employer.decisionNoteVisible')}
        </Text>
      </Pressable>
      <Text variant="caption" tone="mutedForeground">
        {hint}
      </Text>
    </View>
  );
}
