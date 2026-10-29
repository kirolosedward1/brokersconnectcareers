import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { trustedLogoUrl } from '@/lib/avatar-url';
import { env } from '~/lib/env';
import { useTheme } from '~/theme/provider';
import { BuildingSilhouette } from '~/components/ui/silhouette';

const SIZES = { sm: 44, md: 52, lg: 72 } as const;
/** Each size's corner, continuous. */
const CORNERS = { sm: 12, md: 14, lg: 20 } as const;

/**
 * A company's mark — the website's CompanyLogo.
 *
 * A supplied logo fills its tile edge to edge, as an app's icon fills its
 * own: a square one exactly, a wider one whole, with white above and below —
 * contain, as the website draws it, never cover: a logo cropped to fill a
 * square is a logo with its name cut off. White behind it, for a logo drawn
 * on nothing (most are drawn for a white ground). Without one — or when it
 * does not load — the generic building, the same for every company: never
 * its initial on a colour of its own.
 */
export function CompanyLogo({
  logoUrl,
  size = 'md',
}: {
  /** Whose mark it is: said by the name beside it, not by the tile. */
  name: string;
  logoUrl?: string | null;
  size?: keyof typeof SIZES;
}) {
  const { colors } = useTheme();
  const px = SIZES[size];
  const corner = { borderRadius: CORNERS[size], borderCurve: 'continuous' as const };
  // A logo that does not load (gone, offline) is the letter, not a blank white tile.
  const [failedLogo, setFailedLogo] = useState<string | null>(null);

  // Only this deployment's own logos bucket is fetched (avatar-url.ts): any
  // other host would learn who scrolls the board, and when.
  const logo = trustedLogoUrl(logoUrl, env.supabaseUrl);

  if (logo && failedLogo !== logo) {
    return (
      <View
        style={{
          width: px,
          height: px,
          ...corner,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          backgroundColor: '#FFFFFF',
          overflow: 'hidden',
        }}
      >
        <Image
          source={{ uri: logo }}
          recyclingKey={logo}
          contentFit="contain"
          style={{ flex: 1 }}
          onError={() => setFailedLogo(logo)}
          accessible={false}
        />
      </View>
    );
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: px, height: px, ...corner, overflow: 'hidden' }}
    >
      <BuildingSilhouette size={px} />
    </View>
  );
}
