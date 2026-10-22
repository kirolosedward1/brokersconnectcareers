import { View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '~/theme/provider';
import { corner } from '~/theme/tokens';

/**
 * The website's illustrations (src/components/illustration.tsx), the same
 * files (tests/brand.test.ts holds them equal): one hand — black line, one
 * blue, white paper — used where there would otherwise be nothing to look at,
 * an empty list or a step that needs a person in it. Never beside real data.
 *
 * Decorative: the words beside each carry the meaning, so VoiceOver skips it.
 * The drawings are black line on transparent; on the dark theme, where the
 * website inverts them, they sit on a pane of their own paper instead.
 */
export const ILLUSTRATIONS = {
  /** A candidate pressing "apply" on a tall screen. */
  apply: { source: require('../../../assets/illustrations/apply.png'), ratio: 1 },
  browse: { source: require('../../../assets/illustrations/browse.png'), ratio: 960 / 639 },
  updates: { source: require('../../../assets/illustrations/updates.png'), ratio: 1 },
  search: { source: require('../../../assets/illustrations/search.png'), ratio: 1 },
  choose: { source: require('../../../assets/illustrations/choose.png'), ratio: 1 },
  verify: { source: require('../../../assets/illustrations/verify.png'), ratio: 960 / 702 },
  write: { source: require('../../../assets/illustrations/write.png'), ratio: 960 / 702 },
  review: { source: require('../../../assets/illustrations/review.png'), ratio: 960 / 702 },
} as const;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

export function Illustration({ name, width }: { name: IllustrationName; width: number }) {
  const { scheme } = useTheme();
  const { source, ratio } = ILLUSTRATIONS[name];
  const image = <Image source={source} contentFit="contain" style={{ width, height: width / ratio }} accessible={false} />;
  if (scheme !== 'dark') {
    return (
      <View accessible={false} importantForAccessibility="no-hide-descendants" testID={`illustration-${name}`}>
        {image}
      </View>
    );
  }
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID={`illustration-${name}`}
      style={{ padding: 12, ...corner('xl'), backgroundColor: '#F3F0EA' }}
    >
      {image}
    </View>
  );
}
