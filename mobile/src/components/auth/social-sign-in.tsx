import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { SymbolView } from 'expo-symbols';
import { useTranslations } from 'use-intl';
import { useMobileConfig } from '~/features/config';
import { appleAvailable, offerGoogle, signInWithApple, signInWithGoogle, type ProviderOutcome } from '~/features/auth/providers';
import { googleClientReady } from '~/features/auth/google';
import { Button } from '~/components/ui/button';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { GoogleMark } from './google-mark';

/**
 * Which one-tap sign-ins this phone is offered today: each only when the auth
 * server will accept it (/api/mobile/v1/config asks GoTrue, as the website's
 * pages do), Apple's only where it can work, and Google on an iPhone only
 * beside Apple (providers.ts, offerGoogle), and Google only once this build
 * carries the client id it asks Google with (google.ts). `settled` once both the server and
 * the phone have answered: until then, what is not yet known is not offered.
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

  const apple = Boolean(config.data?.providers.apple) && appleHere === true;
  const google = googleClientReady() && offerGoogle({ google: Boolean(config.data?.providers.google), apple, ios: Platform.OS === 'ios' });
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
 * Sign in or sign up with Apple and with Google, each shown only when it is
 * offered (useSocialProviders) — above the form with the website's "or" under
 * them, or (`separator={false}`) as the ways in themselves, with another of the
 * same kind after them (`children`: "Continue with email").
 *
 * Apple's is Apple's own button, drawn by iOS in the phone's language, as the
 * App Store asks; black in the light theme and white in the dark.
 */
export function SocialSignIn({
  mode,
  disabled,
  onBusy,
  onOutcome,
  separator = true,
  separatorLabel,
  children,
}: {
  mode: 'sign-in' | 'sign-up';
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  /** Awaited: the buttons stay busy until whatever follows a sign-in has run. */
  onOutcome: (outcome: ProviderOutcome) => void | Promise<void>;
  separator?: boolean;
  /** The words between the buttons and the form: the website's "or" unless the page says more. */
  separatorLabel?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('auth');
  const tApp = useTranslations('app.auth');
  const { scheme } = useTheme();
  const { apple, google } = useSocialProviders();
  if (!apple && !google && !children) return null;

  const run = (provider: () => Promise<ProviderOutcome>) => runProvider(provider, onBusy, onOutcome);

  return (
    <View style={{ gap: space[4] }}>
      <View style={{ gap: space[3] }}>
        {apple ? (
          <View pointerEvents={disabled ? 'none' : 'auto'} style={{ opacity: disabled ? 0.5 : 1 }}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                mode === 'sign-up'
                  ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                  : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
              }
              buttonStyle={
                scheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              // The same capsule as the Google button under it: 56 high, round ends.
              cornerRadius={28}
              style={{ height: 56 }}
              onPress={() => run(signInWithApple)}
            />
          </View>
        ) : null}
        {google ? (
          <Button
            label={mode === 'sign-up' ? t('signUpWithGoogle') : tApp('continueGoogle')}
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
            {separatorLabel ?? t('or')}
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
 * The one-tap sign-ins as round buttons, the mark alone on white: for beside
 * another button over a dark picture (the welcome's Sign in), where a full
 * "Sign in with Google" would not fit. Each only when it is offered
 * (useSocialProviders), Google's first and Apple's after it, the same size —
 * Apple's no less prominent than Google's (App Review 4.8). White under
 * Apple's mark, as Apple asks of its button on a dark ground. Busy, the one
 * pressed turns while the rest wait.
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
  const { apple, google } = useSocialProviders();
  const [running, setRunning] = useState<'apple' | 'google' | null>(null);

  const run = (which: 'apple' | 'google', provider: () => Promise<ProviderOutcome>) => {
    setRunning(which);
    const busy = (now: boolean) => {
      onBusy(now);
      if (!now) setRunning(null);
    };
    // A sign-in that throws past its outcome is not left to the console: the buttons come back.
    runProvider(provider, busy, onOutcome).catch(() => {});
  };

  return (
    <>
      {google ? (
        <ProviderCircle
          testID="welcome-google"
          size={size}
          label={t('auth.signInWithGoogle')}
          hint={t('app.welcome.signInGoogleHint')}
          disabled={disabled}
          busy={running === 'google'}
          onPress={() => run('google', signInWithGoogle)}
        >
          <GoogleMark size={Math.round(size * 0.42)} />
        </ProviderCircle>
      ) : null}
      {apple ? (
        <ProviderCircle
          testID="welcome-apple"
          size={size}
          label={t('auth.signInWithApple')}
          hint={t('app.welcome.signInAppleHint')}
          disabled={disabled}
          busy={running === 'apple'}
          onPress={() => run('apple', signInWithApple)}
        >
          <SymbolView name="applelogo" size={Math.round(size * 0.44)} tintColor="#000000" />
        </ProviderCircle>
      ) : null}
    </>
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
