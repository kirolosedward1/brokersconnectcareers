import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { useMobileConfig } from '~/features/config';
import { appleAvailable, offerGoogle, signInWithApple, signInWithGoogle, type ProviderOutcome } from '~/features/auth/providers';
import { Button, buttonHeight } from '~/components/ui/button';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { AppleSignInButton } from './apple-sign-in-button';
import { GoogleMark } from './google-mark';

/**
 * Which one-tap sign-ins this phone is offered today: each only when the auth
 * server will accept it (/api/mobile/v1/config asks GoTrue, as the website's
 * pages do). On iOS, Apple's is the system sheet, and only where that sheet
 * can work. On Android it is the same browser sign-in Google already uses.
 * Google on an iPhone is offered only beside Apple (providers.ts, offerGoogle).
 * `settled` once both the server and the phone have answered: until then, what
 * is not yet known is not offered.
 */
export function useSocialProviders(): { apple: boolean; google: boolean; settled: boolean } {
  const config = useMobileConfig();
  const [appleHere, setAppleHere] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    appleAvailable().then((available) => {
      if (active) setAppleHere(available);
    });
    return () => {
      active = false;
    };
  }, []);

  const configApple = Boolean(config.data?.providers.apple);
  // iOS: the system sheet. Anywhere else: the browser, once we know the sheet
  // is not the way (appleAvailable has answered, and on Android it is false).
  const apple = configApple && (Platform.OS === 'ios' ? appleHere === true : appleHere !== null);
  const google = offerGoogle({ google: Boolean(config.data?.providers.google), apple, ios: Platform.OS === 'ios' });
  return { apple, google, settled: !config.isPending && appleHere !== null };
}

/**
 * Runs one of the one-tap sign-ins with the buttons busy throughout, until
 * whatever follows it (`onOutcome`, awaited) has run. A promise chain, not
 * try/finally, which the React Compiler does not compile.
 */
export function runProvider(
  provider: () => Promise<ProviderOutcome>,
  onBusy: (busy: boolean) => void,
  onOutcome: (outcome: ProviderOutcome) => void | Promise<void>,
) {
  onBusy(true);
  const done = () => onBusy(false);
  return provider()
    .then(onOutcome)
    .then(done, (failure: unknown) => {
      done();
      throw failure;
    });
}

/**
 * "Sign in with Apple" and "Continue with Google", each shown only when it is
 * offered (useSocialProviders) — above the form with the website's "or" under
 * them, or (`separator={false}`) as the ways in themselves, with another of the
 * same kind after them (`children`: "Continue with email").
 *
 * Apple's is Apple's own button on iOS, drawn by the phone in its language
 * (SIGN_IN: «تسجيل الدخول باستخدام Apple» on an Arabic phone), black in the
 * light theme and white in the dark, and the same height and width as the
 * Google button under it.
 */
export function SocialSignIn({
  disabled,
  onBusy,
  onOutcome,
  separator = true,
  children,
}: {
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  /** Awaited: the buttons stay busy until whatever follows a sign-in has run. */
  onOutcome: (outcome: ProviderOutcome) => void | Promise<void>;
  separator?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('auth');
  const { apple, google } = useSocialProviders();
  if (!apple && !google && !children) return null;

  const run = (provider: () => Promise<ProviderOutcome>) => runProvider(provider, onBusy, onOutcome);

  return (
    <View style={{ gap: space[4] }}>
      <View style={{ gap: space[3] }}>
        {apple ? (
          <AppleSignInButton disabled={disabled} height={buttonHeight.lg} onPress={() => run(signInWithApple)} />
        ) : null}
        {google ? (
          <Button
            label={t('continueWithGoogle')}
            variant="outline"
            size="lg"
            icon={<GoogleMark />}
            disabled={disabled}
            onPress={() => run(signInWithGoogle)}
          />
        ) : null}
        {children}
      </View>

      {/* The separator belongs to the buttons: without them there is nothing for "or" to separate. */}
      {separator && (apple || google) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Separator />
          <Text variant="caption" tone="mutedForeground">
            {t('or')}
          </Text>
          <Separator />
        </View>
      ) : null}
    </View>
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />;
}

/**
 * Google as a round button, the mark alone on white: beside Sign in over a
 * dark picture (the welcome), where a full "Continue with Google" would not
 * fit. Shown only when Google is offered (useSocialProviders). Apple is not
 * drawn here — it is Apple's own button, full width, the same size as Sign in
 * (AppleSignInButton). Busy, the one pressed turns.
 */
export function SocialCircles({
  size,
  disabled,
  onBusy,
  onOutcome,
}: {
  size: number;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onOutcome: (outcome: ProviderOutcome) => void | Promise<void>;
}) {
  const t = useTranslations();
  const { google } = useSocialProviders();
  const [running, setRunning] = useState(false);
  if (!google) return null;

  const run = () => {
    setRunning(true);
    const busy = (now: boolean) => {
      onBusy(now);
      if (!now) setRunning(false);
    };
    // A sign-in that throws past its outcome is not left to the console: the button comes back.
    runProvider(signInWithGoogle, busy, onOutcome).catch(() => {});
  };

  return (
    <ProviderCircle
      testID="welcome-google"
      size={size}
      label={t('auth.continueWithGoogle')}
      hint={t('app.welcome.signInGoogleHint')}
      disabled={disabled}
      busy={running}
      onPress={run}
    >
      <GoogleMark size={Math.round(size * 0.42)} />
    </ProviderCircle>
  );
}

function ProviderCircle({
  testID,
  size,
  label,
  hint,
  disabled,
  busy,
  onPress,
  children,
}: {
  testID: string;
  size: number;
  label: string;
  hint: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const inactive = disabled || busy;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        ...corner('full'),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? '#E8EAED' : '#FFFFFF',
        boxShadow: '0px 8px 22px rgba(5, 10, 25, 0.32)',
        opacity: disabled && !busy ? 0.45 : 1,
      })}
    >
      {busy ? <ActivityIndicator color="#1F1F1F" /> : children}
    </PressableScale>
  );
}
