import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { space } from '~/theme/tokens';
import { Text } from '~/components/ui/text';

/**
 * The page every sign-in screen sits on: scrolls with the keyboard up, keeps
 * taps on buttons while a field is focused, and gives the form the website's
 * narrow column.
 */
export function AuthScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[5] }}
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
