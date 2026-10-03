import { useWindowDimensions } from 'react-native';

/**
 * Whether the phone's text is at one of the accessibility sizes (Settings →
 * Accessibility → Display & Text Size → Larger Text). iOS's font scale is
 * 1.353 at the largest ordinary size and 1.786 at the first accessibility one
 * (React Native's RCTAccessibilityManager), up to 3.571; 1.4 falls between.
 *
 * There, what sat side by side stacks, lines are not cut short, and a word
 * is never broken: Arabic split mid-word loses its joined letters.
 */
export const LARGE_TEXT_SCALE = 1.4;

export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
}
