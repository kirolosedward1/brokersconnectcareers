import type { ReactNode, Ref } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogo } from '~/components/brand/brand-logo';
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
 * The page's heading and the sentence under it, under the website's logo —
 * as the website's own sign-in page has it — so a sheet that asks for a
 * password says whose it is. Centred over the page, a size under the app's
 * largest titles: a sheet's heading, not a page's.
 */
export function AuthHeading({ title, body }: { title: string; body?: string | null }) {
  return (
    <View style={{ gap: space[1], width: '100%' }}>
      <View style={{ marginBottom: space[3], alignItems: 'center' }}>
        <BrandLogo size="form" />
      </View>
      <Text variant="display" weight="bold" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? (
        <Text variant="small" tone="mutedForeground" style={styles.centred}>
          {body}
        </Text>
      ) : null}
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

const styles = StyleSheet.create({
  centred: { textAlign: 'center', width: '100%' },
  title: { textAlign: 'center', width: '100%', fontSize: 26, lineHeight: 38 },
});
