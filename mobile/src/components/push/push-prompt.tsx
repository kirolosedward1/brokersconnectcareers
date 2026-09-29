import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { BellRing } from 'lucide-react-native';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { usePushControls } from '~/features/push/controls';
import { pushAvailable, usePushState } from '~/features/push/device';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * The phone's question, asked with its reason: on Home, for somebody the
 * phone has not asked yet, saying what they would hear about. "Not now" puts
 * it away for good; the switch in the account stays.
 */
export function PushPrompt({ audience }: { audience: 'candidate' | 'employer' }) {
  const t = useTranslations('app.push');
  const { colors } = useTheme();
  const state = usePushState().data;
  const { turnOn, dismissPrompt } = usePushControls();

  if (!pushAvailable() || !state || state.permission !== 'undetermined' || state.off || state.promptDismissed) return null;

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <BellRing size={18} color={colors.primary} />
        <Text weight="semibold" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {t('promptTitle')}
        </Text>
      </View>
      <Text variant="small" tone="mutedForeground">
        {audience === 'employer' ? t('promptEmployer') : t('promptCandidate')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Button label={t('turnOn')} size="sm" loading={turnOn.isPending} onPress={() => turnOn.mutate()} />
        <Button label={t('notNow')} variant="ghost" size="sm" onPress={() => dismissPrompt.mutate()} />
      </View>
      {turnOn.isError ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {t('failed')}
        </Text>
      ) : null}
    </Card>
  );
}
