import { Platform } from 'react-native';

/**
 * Whether the bars are iOS 26's Liquid Glass, whose tab bar can shrink out of
 * the way as a list scrolls. Read each time it is asked, so a test can say
 * which iOS it is on.
 */
export function liquidGlass(): boolean {
  return Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;
}
