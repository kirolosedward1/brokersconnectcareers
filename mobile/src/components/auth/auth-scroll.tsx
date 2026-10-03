import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { Text } from '~/components/ui/text';

const MARK = require('../../../assets/images/icon.png');

/**
 * The page every sign-in screen sits on: scrolls with the keyboard up, keeps
 * taps on buttons while a field is focused, and gives the form the website's
 * narrow column.
 *
 * Clear of the system's bars on both platforms. iOS keeps a scroll view clear
 * of them by itself (contentInsetAdjustmentBehavior); Android draws the app
 * edge to edge and does not, so there the page leaves room for the navigation
 * bar, and — on a `bare` screen, drawn without a header — for the status bar,
 * which the heading sat under.
 */
export function AuthScroll({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{
        padding: gutter,
        paddingTop: space[4] + (android && bare ? insets.top : 0),
        paddingBottom: space[10] + (android ? insets.bottom : 0),
        gap: space[5],
      }}
    >
      {children}
    </ScrollView>
  );
}

/**
 * The page's heading and the sentence under it, under the brand's mark on
 * its white tile — the app's own icon, as the home screen shows it — so a
 * sheet that asks for a password says whose it is. The mark is drawing; the
 * heading says the words.
 */
export function AuthHeading({ title, body }: { title: string; body?: string | null }) {
  const { colors, shadow } = useTheme();
  return (
    <View style={{ gap: space[1] }}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 56,
          height: 56,
          marginBottom: space[3],
          ...corner('lg'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          backgroundColor: '#FFFFFF',
          boxShadow: shadow.card,
          overflow: 'hidden',
        }}
      >
        <Image source={MARK} contentFit="cover" style={{ flex: 1 }} accessible={false} />
      </View>
      <Text variant="display" weight="bold" accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text tone="mutedForeground">{body}</Text> : null}
    </View>
  );
}

/** "Have an account? Sign in" under the form; the question may be left out. */
export function AuthSwitch({ question, action, onPress }: { question?: string; action: string; onPress: () => void }) {
  return (
    <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
      {question ? `${question} ` : null}
      <Text variant="small" weight="semibold" tone="primary" accessibilityRole="link" onPress={onPress} suppressHighlighting>
        {action}
      </Text>
    </Text>
  );
}
