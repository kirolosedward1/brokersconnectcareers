import type { ReactNode } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gutter, space } from '~/theme/tokens';
import { Text } from '~/components/ui/text';

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

/** The page's heading and the sentence under it. */
export function AuthHeading({ title, body }: { title: string; body?: string | null }) {
  return (
    <View style={{ gap: space[1] }}>
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
