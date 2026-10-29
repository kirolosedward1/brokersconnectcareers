import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import { useTranslations } from 'use-intl';
import { BrandLogo } from '~/components/brand/brand-logo';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { lockOnReturn, markProven, proveOwner, useAppLockOn, useProvenFor } from '~/features/app-lock/lock';
import { signOutHere } from '~/features/push/device';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * In front of every screen, for somebody signed in:
 *
 * - **The cover.** While the app is not in front — the app switcher, a call,
 *   Control Center — the screens are covered by the page and the logo, so the
 *   picture iOS keeps of the app for its switcher is not an applicant's number
 *   or CV. Nothing is covered for a signed-out reader: the board is public.
 * - **The lock**, for a person who turned it on (features/app-lock): at
 *   launch, and back from the background after a minute, the app asks the
 *   phone's own check before it shows anything. Signing out is the way past
 *   it for somebody who cannot; a sign-in has just proved who it is, and is
 *   not asked again.
 *
 * Over the tab screens. The sheets the root stack presents (sign-in,
 * onboarding, the code) and the pickers' page sheets sit above it, and none
 * of them shows anybody else's data.
 */
export function AppLock() {
  const t = useTranslations('app.lock');
  const { colors } = useTheme();
  const { ready, session } = useSession();
  const userId = session?.user.id ?? null;
  const on = useAppLockOn(userId);
  const provenFor = useProvenFor();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState as AppStateStatus);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const leftAt = useRef<number | null>(null);
  const asked = useRef(false);

  // A sign-in (or a sign-out) after launch: whoever is here now just proved it.
  // The person a launch finds signed in has proved nothing yet.
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    if (seen.current !== undefined && seen.current !== userId) markProven(userId);
    seen.current = userId;
  }, [ready, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setAppState(next);
      // Only the background counts as away: the Face ID sheet, a banner pulled
      // down or Control Center leave the app inactive, never in the background.
      if (next === 'background') leftAt.current ??= Date.now();
      if (next === 'active') {
        if (lockOnReturn(leftAt.current, Date.now())) {
          asked.current = false;
          setFailed(false);
          markProven(null);
        }
        leftAt.current = null;
      }
    });
    return () => subscription.remove();
  }, []);

  const showLock = Boolean(userId) && on === true && provenFor !== userId;
  // 'unknown' (a cold start, before iOS has said) counts as in front.
  const away = appState === 'inactive' || appState === 'background';

  const unlock = useCallback(async () => {
    if (!userId) return;
    setChecking(true);
    setFailed(false);
    const proof = await proveOwner(t('prompt'), t('cancel'));
    setChecking(false);
    if (proof === 'ok') markProven(userId);
    // Missing/unavailable biometrics are not proof of ownership. Keep the
    // lock and offer retry or sign-out rather than silently disabling it.
    else if (proof === 'impossible' || proof === 'failed') setFailed(true);
  }, [t, userId]);

  // Asked at once each time it locks, once; cancelled, the button asks again.
  useEffect(() => {
    if (!showLock || away || asked.current) return;
    asked.current = true;
    unlock();
  }, [showLock, away, unlock]);

  const covered = Boolean(session) && (on === undefined || away);
  if (!showLock && !covered) return null;

  return (
    <View
      testID={showLock ? 'app-lock' : 'privacy-cover'}
      accessibilityViewIsModal
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: gutter, gap: space[5] },
      ]}
    >
      <BrandLogo size="hero" />
      {showLock ? (
        <>
          <View style={{ gap: space[2], alignItems: 'center' }}>
            <Text variant="title" weight="semibold" style={{ textAlign: 'center' }} accessibilityRole="header">
              {t('title')}
            </Text>
            <Text tone="mutedForeground" style={{ textAlign: 'center' }}>
              {t('body')}
            </Text>
          </View>
          <View style={{ alignSelf: 'stretch', gap: space[2] }}>
            <Button label={t('unlock')} loading={checking} onPress={unlock} />
            <Button label={t('signOut')} variant="ghost" disabled={checking} onPress={() => signOutHere().catch(() => {})} />
          </View>
          {failed ? (
            <Text variant="small" tone="destructive" accessibilityRole="alert" style={{ textAlign: 'center' }}>
              {t('failed')}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
