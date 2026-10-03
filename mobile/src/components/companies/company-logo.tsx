import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { trustedLogoUrl } from '@/lib/avatar-url';
import { env } from '~/lib/env';
import { useTheme } from '~/theme/provider';
import { type as scale } from '~/theme/tokens';
import { Text } from '~/components/ui/text';

const SIZES = { sm: 44, md: 52, lg: 72 } as const;
/** Each size's corner, continuous, and its letter. */
const CORNERS = { sm: 12, md: 14, lg: 20 } as const;
const LETTERS = { sm: 'headline', md: 'title', lg: 'display' } as const satisfies Record<keyof typeof SIZES, keyof typeof scale>;

/**
 * A company's mark — the website's CompanyLogo.
 *
 * Supplied logos sit on white and are contained, never cropped (most are drawn
 * for a white ground, and a cropped logo loses its name). Without one, the
 * first letter on one of four theme tints — sapphire, champagne, the hero's
 * navy, stone — chosen from the slug by the website's hash, so a company is
 * always drawn in the same one.
 */
function tintIndex(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 4;
}

export function CompanyLogo({
  name,
  logoUrl,
  seed,
  size = 'md',
}: {
  name: string;
  logoUrl?: string | null;
  seed?: string;
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
          padding: size === 'lg' ? 8 : 5,
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

  const tints = [
    { background: colors.secondary, text: colors.primary },
    { background: colors.accent, text: colors.accentForeground },
    { background: colors.hero, text: colors.champagne },
    { background: colors.muted, text: colors.foreground },
  ];
  const tint = tints[tintIndex(seed || name)];

  // Hidden, letter and all: `accessible={false}` alone leaves the Text inside
  // to VoiceOver, which read a stray letter before the company's name.
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: px,
        height: px,
        ...corner,
        backgroundColor: tint.background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text weight="semibold" variant={LETTERS[size]} style={{ color: tint.text }}>
        {name.trim().charAt(0)}
      </Text>
    </View>
  );
}
