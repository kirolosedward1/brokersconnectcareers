import type { ReactNode, Ref } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InlineLink } from '~/components/ui/inline-link';
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
export function AuthScroll({ ref, children, bare = false }: { ref?: Ref<ScrollViewInstance>; children: ReactNode; bare?: boolean }) {
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return (
    <ScrollView
      ref={ref}
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
 * The page's heading and the sentence under it, as the v1.1 boards draw every
 * sign-in page (SignIn, Forgot, NewPassword, MFA): the screen's own title,
 * bold, where the line starts, and a muted sentence under it. The logo is the
 * welcome's, not the form's. `centred` for a state that stands alone on the
 * page (the Confirm board: the link was opened, or it failed).
 */
export function AuthHeading({ title, body, centred = false }: { title: string; body?: string | null; centred?: boolean }) {
  const align = centred ? styles.centred : null;
  return (
    <View style={{ gap: space[1], width: '100%' }}>
      <Text variant="screen" weight="bold" accessibilityRole="header" style={align}>
        {title}
      </Text>
      {body ? (
        <Text variant="small" tone="mutedForeground" style={align}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/** "Have an account? Sign in" under the form; the question may be left out. */
export function AuthSwitch({ question, action, onPress }: { question?: string; action: string; onPress: () => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
      {question ? (
        <Text variant="small" tone="mutedForeground" style={{ maxWidth: '100%', textAlign: 'center' }}>
          {`${question} `}
        </Text>
      ) : null}
      <InlineLink onPress={onPress}>{action}</InlineLink>
    </View>
  );
}

const styles = StyleSheet.create({
  centred: { textAlign: 'center', width: '100%' },
});
