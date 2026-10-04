import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { useUpdateRequired } from '~/features/update';
import { useWorkInProgress } from '~/lib/use-leave-guard';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * Everything, unless this build is older than the website will serve — then
 * one screen saying so, with the way to the App Store once the app is listed
 * there. Nothing behind it is drawn: a screen that half-works against an API
 * that has moved on is worse than one that says why it will not.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const t = useTranslations('app.update');
  const { colors } = useTheme();
  const { required, storeUrl } = useUpdateRequired();
  // The floor can rise while the app is open (the config is read again on
  // coming back to it). Replacing every screen then would throw away what a
  // form holds, unasked; it waits until that is saved or let go.
  const busy = useWorkInProgress();

  if (!required || busy) return children;

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[3],
        padding: space[6],
        backgroundColor: colors.background,
      }}
    >
      <Text variant="title" weight="bold" accessibilityRole="header" style={{ textAlign: 'center' }}>
        {t('title')}
      </Text>
      <Text tone="mutedForeground" style={{ textAlign: 'center' }}>
        {t('body')}
      </Text>
      {storeUrl ? <Button label={t('cta')} size="lg" onPress={() => Linking.openURL(storeUrl).catch(() => {})} /> : null}
    </View>
  );
}
