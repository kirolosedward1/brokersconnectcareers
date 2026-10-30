import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { trustedAvatarUrl } from '@/lib/avatar-url';
import { env } from '~/lib/env';
import { useTheme } from '~/theme/provider';
import { PersonGlyph } from './silhouette';

const SIZES = { sm: 36, md: 44, lg: 64 } as const;

/**
 * A person, as a circle — the website's Avatar — or, `rounded`, a square with
 * soft corners (Home's greeting): the photo when there is one the site would
 * fetch (its own storage, or a Google picture), otherwise the generic
 * person's silhouette — the same for everyone, never their initial on a
 * colour of its own.
 */
export function Avatar({
  src,
  size = 'sm',
  shape = 'circle',
}: {
  /** Who it is: said by the words beside it, not by the picture. */
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  shape?: 'circle' | 'rounded';
}) {
  const { colors } = useTheme();
  const px = SIZES[size];
  const photo = trustedAvatarUrl(src, env.supabaseUrl);
  // Which photo failed, not whether one did: a list reuses this component for
  // other people as it scrolls, and a failure must not follow the row.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const frame = {
    width: px,
    height: px,
    borderRadius: shape === 'rounded' ? Math.round(px * 0.28) : px / 2,
    borderCurve: 'continuous' as const,
    overflow: 'hidden' as const,
  };

  if (photo && failedPhoto !== photo) {
    return (
      <View accessible={false} style={frame}>
        <Image
          source={{ uri: photo }}
          recyclingKey={photo}
          contentFit="cover"
          style={{ flex: 1 }}
          onError={() => setFailedPhoto(photo)}
          accessible={false}
        />
      </View>
    );
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ ...frame, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}
    >
      <PersonGlyph size={Math.round(px * 0.58)} color={colors.mutedForeground} />
    </View>
  );
}
