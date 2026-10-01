import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '~/theme/provider';
import { radius } from '~/theme/tokens';
import { Text } from '~/components/ui/text';

const SIZES = { sm: 40, md: 48, lg: 64 } as const;

/**
 * A company's mark — the website's CompanyLogo.
 *
 * Supplied logos sit on white and are contained, never cropped (most are drawn
 * for a white ground, and a cropped logo loses its name). Without one, the
 * first letter on one of four theme tints, chosen from the slug by the same
 * hash as the website, so a company keeps its colour on both.
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
  const corner = size === 'sm' ? radius.lg : radius.xl;
  // A logo that does not load (gone, offline) is the letter, not a blank white tile.
  const [failedLogo, setFailedLogo] = useState<string | null>(null);

  if (logoUrl && failedLogo !== logoUrl) {
    return (
      <View
        style={{
          width: px,
          height: px,
          borderRadius: corner,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: '#FFFFFF',
          overflow: 'hidden',
          padding: 4,
        }}
      >
        <Image
          source={{ uri: logoUrl }}
          recyclingKey={logoUrl}
          contentFit="contain"
          style={{ flex: 1 }}
          onError={() => setFailedLogo(logoUrl)}
          accessible={false}
        />
      </View>
    );
  }

  const tints = [
    { background: colors.secondary, text: colors.primary },
    { background: colors.accent, text: colors.accentForeground },
    { background: colors.successMuted, text: colors.success },
    { background: colors.warningMuted, text: colors.warning },
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
        borderRadius: corner,
        backgroundColor: tint.background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text weight="bold" variant={size === 'lg' ? 'title' : 'small'} style={{ color: tint.text }}>
        {name.trim().charAt(0)}
      </Text>
    </View>
  );
}
