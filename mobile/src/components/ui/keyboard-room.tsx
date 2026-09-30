import type { ReactElement, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';

/**
 * Room for the keyboard on Android.
 *
 * The app is drawn edge to edge there, and then the system no longer shrinks
 * the window for the keyboard (adjustResize does nothing): a field low in a
 * form stayed under the keyboard, and its scroll view, still as tall as the
 * screen, saw no reason to bring it up. This takes the part of the screen the
 * keyboard covers off the bottom, as the window used to shrink, and the scroll
 * view brings the focused field into what is left. It measures what it
 * covers, so where the system does still shrink the window it adds nothing.
 *
 * It reckons from its own top, so it goes where a screen starts at the top of
 * the phone: around a whole stack, header and all, never around the part of a
 * screen below its header. The tab bar is left out — the keyboard covers it,
 * as Android's native tabs mean it to, rather than lifting it (and its band
 * for the system's buttons) above the keyboard.
 *
 * iOS keeps its own way: each scroll view makes room itself
 * (automaticallyAdjustKeyboardInsets). A Modal is a window of its own, and a
 * sheet with fields wraps its content in one of these too.
 */
export function KeyboardRoom({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'android') return children;
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      {children}
    </KeyboardAvoidingView>
  );
}

/**
 * The root stack's screens (its `screenLayout`), each in a room of its own:
 * the sign-in sheet, onboarding, the second factor, the email links. Not the
 * tabs, whose stacks each have one above the tab bar.
 */
export function roomForScreen({ route, children }: { route: { name: string }; children: ReactElement }): ReactElement {
  return route.name === '(tabs)' ? children : <KeyboardRoom>{children}</KeyboardRoom>;
}
