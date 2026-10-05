import { appDirection } from '~/lib/direction';
import { ChevronLeft, ChevronRight, SendHorizontal, type LucideProps } from './lucide';

/**
 * "Onward" and "back" as the reading direction has them — the website's
 * `rtl-flip`. In Arabic onward points left; were the app ever laid out left to
 * right, the same component points right, with nothing to change at call sites.
 */
export function ForwardChevron(props: LucideProps) {
  return appDirection === 'rtl' ? <ChevronLeft {...props} /> : <ChevronRight {...props} />;
}

/** "Send" pointing the way the text runs, as the website flips it (`rtl-flip`). */
export function SendForward(props: LucideProps) {
  return (
    <SendHorizontal {...props} style={[props.style, appDirection === 'rtl' ? { transform: [{ scaleX: -1 }] } : null]} />
  );
}
