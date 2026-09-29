import { I18nManager } from 'react-native';
import { ChevronLeft, ChevronRight, type LucideProps } from 'lucide-react-native';

/**
 * "Onward" and "back" as the reading direction has them — the website's
 * `rtl-flip`. In Arabic onward points left; were the app ever laid out left to
 * right, the same component points right, with nothing to change at call sites.
 */
export function ForwardChevron(props: LucideProps) {
  return I18nManager.isRTL ? <ChevronLeft {...props} /> : <ChevronRight {...props} />;
}
