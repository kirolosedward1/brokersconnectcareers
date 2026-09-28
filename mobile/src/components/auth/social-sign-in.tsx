import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslations } from 'use-intl';
import { useMobileConfig } from '~/features/config';
import { appleAvailable, signInWithApple, signInWithGoogle, type ProviderOutcome } from '~/features/auth/providers';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';
import { GoogleMark } from './google-mark';

/**
 * "Continue with Apple" and "Continue with Google", above the form, with the
 * website's "or" under them — each shown only when the auth server will accept
 * it today (/api/mobile/v1/config asks GoTrue, as the website's pages do).
 *
 * Apple's is Apple's own button, drawn by iOS in the phone's language, as the
 * App Store asks; black in the light theme and white in the dark.
 */
export function SocialSignIn({
  mode,
  disabled,
  onBusy,
  onOutcome,
}: {
  mode: 'sign-in' | 'sign-up';
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  /** Awaited: the buttons stay busy until whatever follows a sign-in has run. */
  onOutcome: (outcome: ProviderOutcome) => void | Promise<void>;
}) {
  const t = useTranslations('auth');
  const { scheme } = useTheme();
  const config = useMobileConfig();
  const [appleHere, setAppleHere] = useState(false);

  useEffect(() => {
    let active = true;
    appleAvailable().then((available) => {
      if (active) setAppleHere(available);
    });
    return () => {
      active = false;
    };
  }, []);

  const apple = Boolean(config.data?.providers.apple) && appleHere;
  const google = Boolean(config.data?.providers.google);
  if (!apple && !google) return null;

  const run = async (provider: () => Promise<ProviderOutcome>) => {
    onBusy(true);
    try {
      await onOutcome(await provider());
    } finally {
      onBusy(false);
    }
  };

  return (
    <View style={{ gap: space[4] }}>
      <View style={{ gap: space[2] }}>
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
              cornerRadius={radius.lg}
              style={{ height: 52 }}
              onPress={() => run(signInWithApple)}
            />
          </View>
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
      </View>

      {/* The separator belongs to the buttons: without them there is nothing for "or" to separate. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Separator />
        <Text variant="caption" tone="mutedForeground">
          {t('or')}
        </Text>
        <Separator />
      </View>
    </View>
  );
}

function Separator() {
  const { colors } = useTheme();
  return <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />;
}
