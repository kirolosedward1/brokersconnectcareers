import { Linking, ScrollView, Switch, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { usePushControls } from '~/features/push/controls';
import { pushAvailable, usePushState } from '~/features/push/device';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

/**
 * Pushes on this phone: on or off for the person signed in, without going to
 * the phone's settings — and when the phone's settings have them off, that
 * said plainly, with the way there. The emails are their own switches
 * (/account/emails); a push is a second delivery of the bell, not a third
 * kind of message.
 */
export default function AlertsScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const { session, viewer } = useSession();
  const state = usePushState();
  const { turnOn, turnOff } = usePushControls();
  const header = <Stack.Screen options={{ title: t('app.push.title') }} />;

  if (!session) {
    return (
      <>
        {header}
        <EmptyState
          title={t('app.account.signedOutTitle')}
          action={<Button label={t('nav.signIn')} onPress={() => router.push('/sign-in')} />}
        />
      </>
    );
  }
  // No push project in this build (Expo Go, or before the EAS project exists):
  // a switch here would turn on nothing.
  if (!pushAvailable()) {
    return (
      <>
        {header}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space[4], gap: space[4] }}>
          <Notice tone="muted">
            <Text variant="small">{t('app.push.unavailable')}</Text>
          </Notice>
        </ScrollView>
      </>
    );
  }
  if (!viewer?.profile || !state.data) {
    return (
      <>
        {header}
        <ViewerPending />
      </>
    );
  }

  const denied = state.data.permission === 'denied';
  const on = state.data.permission === 'granted' && !state.data.off;
  const pending = turnOn.isPending || turnOff.isPending;
  const hint = viewer.profile.role === 'employer' ? t('app.push.hintEmployer') : t('app.push.hintCandidate');

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[4] }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            padding: space[4],
            borderRadius: radius.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium">{t('app.push.switch')}</Text>
            <Text variant="small" tone="mutedForeground">
              {hint}
            </Text>
          </View>
          <Switch
            value={on}
            onValueChange={(next) => (next ? turnOn.mutate() : turnOff.mutate())}
            disabled={denied || pending}
            accessibilityLabel={t('app.push.switch')}
            accessibilityHint={hint}
            trackColor={{ true: colors.primary, false: colors.input }}
          />
        </View>

        {/* The phone said no: only its settings can say yes now. */}
        {denied ? (
          <Notice tone="muted">
            <Text variant="small">{t('app.push.denied')}</Text>
            <View style={{ alignItems: 'flex-start', marginTop: space[2] }}>
              <Button
                label={t('app.push.openSettings')}
                variant="outline"
                size="sm"
                onPress={() => Linking.openSettings().catch(() => {})}
              />
            </View>
          </Notice>
        ) : null}

        {turnOn.isError ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {t('app.push.failed')}
          </Text>
        ) : null}
        {turnOff.isError ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {t('common.errorBody')}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
