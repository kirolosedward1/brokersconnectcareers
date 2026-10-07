import type { ReactNode } from 'react';
import { View } from 'react-native';
import { appDirection } from '~/lib/direction';
import { ChevronLeft, ChevronRight, LogIn, LogOut, SendHorizontal, type LucideProps } from './lucide';

/**
 * "Onward" and "back" as the reading direction has them — the website's
 * `rtl-flip`. In Arabic onward points left; were the app ever laid out left to
 * right, the same component points right, with nothing to change at call sites.
 */
export function ForwardChevron(props: LucideProps) {
  return appDirection === 'rtl' ? <ChevronLeft {...props} /> : <ChevronRight {...props} />;
}

/** "Back", the other way: in Arabic it points right. */
export function BackChevron(props: LucideProps) {
  return appDirection === 'rtl' ? <ChevronRight {...props} /> : <ChevronLeft {...props} />;
}

/** "Send" pointing the way the text runs, as the website flips it (`rtl-flip`). */
export function SendForward(props: LucideProps) {
  return (
    <Mirrored>
      <SendHorizontal {...props} />
    </Mirrored>
  );
}

/** "Sign in": the arrow comes in the way the reading goes, as "Sign out" leaves (below). */
export function SignInMark(props: LucideProps) {
  return (
    <Mirrored>
      <LogIn {...props} />
    </Mirrored>
  );
}

/** "Sign out": the arrow leaves through the side the reading ends on, as iOS flips its own. */
export function SignOutMark(props: LucideProps) {
  return (
    <Mirrored>
      <LogOut {...props} />
    </Mirrored>
  );
}

/**
 * A glyph turned to face the other way in Arabic. The turn is a view's, about
 * its middle: put on the drawing itself, react-native-svg turns what it draws
 * about its corner instead, out of its own box, and the icon showed as nothing.
 */
function Mirrored({ children }: { children: ReactNode }) {
  if (appDirection !== 'rtl') return children;
  return (
    <View testID="mirrored" style={{ transform: [{ scaleX: -1 }] }}>
      {children}
    </View>
  );
}
