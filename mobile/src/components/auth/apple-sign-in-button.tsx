import { useState } from 'react';
import { Platform, View, type LayoutChangeEvent } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslations } from 'use-intl';
import { buttonHeight } from '~/components/ui/button';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { AppleMark } from './apple-mark';

/**
 * Sign in with Apple, the same size as the other sign-in buttons.
 *
 * On iOS this is Apple's own button (`AppleAuthenticationButton`), type
 * SIGN_IN, so the phone writes its own words: «تسجيل الدخول باستخدام Apple»
 * when the phone is Arabic. Black on a light page, white on a dark one.
 * Height and capsule corner match `Button` at the same size, and the width is
 * the column's, never a narrower control.
 *
 * Android has no system sheet. The app already signs in with Google through
 * the browser, and Apple goes the same way, on a button of the same size
 * with the same Arabic words.
 */
export function AppleSignInButton({
  disabled,
  onPress,
  height = buttonHeight.lg,
  onDark = false,
}: {
  disabled: boolean;
  onPress: () => void;
  /** The height of the button beside it. Never shorter than that. */
  height?: number;
  /** The welcome sits on a dark photograph in either appearance. */
  onDark?: boolean;
}) {
  const { scheme } = useTheme();
  const darkGround = onDark || scheme === 'dark';
  const [width, setWidth] = useState<number | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  if (Platform.OS === 'ios') {
    return (
      <View pointerEvents={disabled ? 'none' : 'auto'} onLayout={onLayout} style={{ width: '100%', opacity: disabled ? 0.5 : 1 }}>
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={
            darkGround
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          // The other buttons are capsules (`corner('full')`). Half the height
          // is that capsule on Apple's button.
          cornerRadius={height / 2}
          style={{ width: width ?? '100%', height }}
          onPress={onPress}
        />
      </View>
    );
  }

  return <AppleBrowserButton disabled={disabled} onPress={onPress} height={height} onDark={darkGround} />;
}

function AppleBrowserButton({
  disabled,
  onPress,
  height,
  onDark,
}: {
  disabled: boolean;
  onPress: () => void;
  height: number;
  onDark: boolean;
}) {
  const t = useTranslations();
  const background = onDark ? '#FFFFFF' : '#000000';
  const color = onDark ? '#000000' : '#FFFFFF';
  return (
    <PressableScale
      testID="apple-sign-in"
      accessibilityRole="button"
      accessibilityLabel={t('app.auth.signInWithApple')}
      accessibilityHint={t('app.welcome.signInAppleHint')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: '100%',
        height,
        minHeight: height,
        ...corner('full'),
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: space[2],
        paddingHorizontal: space[5],
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <AppleMark size={Math.round(height * 0.42)} color={color} />
      <Text weight="semibold" style={{ color, flexShrink: 1, textAlign: 'center' }}>
        {t('app.auth.signInWithApple')}
      </Text>
    </PressableScale>
  );
}
