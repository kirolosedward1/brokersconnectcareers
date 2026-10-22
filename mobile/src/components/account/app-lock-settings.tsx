import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Card } from '~/components/ui/card';
import { Lock } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { canLock, markProven, proveOwner, setAppLock, useAppLockOn } from '~/features/app-lock/lock';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * The app lock's switch (components/navigation/app-lock.tsx): on this phone,
 * for this person. Either way the phone's own check is asked first, so a
 * phone picked up unlocked cannot turn the lock off, and turning it on proves
 * the phone can open it again. Not offered on a phone with no passcode, where
 * there is nothing to ask.
 */
export function AppLockSettings() {
  const t = useTranslations('app.lock');
  const { colors } = useTheme();
  const userId = useSession().session?.user.id ?? null;
  const on = useAppLockOn(userId);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    canLock().then((can) => {
      if (live) setAvailable(can);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!userId || on === undefined || available === null) return null;
  if (!available && !on) return null;

  const flip = async (next: boolean) => {
    setFailed(false);
    setPending(true);
    const proof = await proveOwner(t('prompt'), t('cancel'));
    if (proof === 'ok' || (proof === 'impossible' && !next)) {
      // Turned on just now, with the check just passed: not asked again at once.
      if (next) markProven(userId);
      await setAppLock(userId, next).catch(() => setFailed(true));
    } else if (proof !== 'cancelled') setFailed(true);
    setPending(false);
  };

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <View style={{ flex: 1, gap: space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Lock size={16} color={colors.foreground} />
            <Text weight="semibold">{t('switch')}</Text>
          </View>
          <Text variant="small" tone="mutedForeground">
            {t('hint')}
          </Text>
        </View>
        <Switch
          testID="app-lock-switch"
          value={on}
          onValueChange={flip}
          disabled={pending}
          accessibilityLabel={t('switch')}
          accessibilityHint={t('hint')}
          trackColor={{ true: colors.primary, false: colors.input }}
        />
      </View>
      {failed ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {t('failed')}
        </Text>
      ) : null}
    </Card>
  );
}
