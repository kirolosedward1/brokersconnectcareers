import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { trustedAvatarUrl } from '@/lib/avatar-url';
import { env } from '~/lib/env';
import { Text } from './text';

/**
 * A person, as a circle — the website's Avatar — or, `rounded`, a square with
 * soft corners (Home's greeting): the photo when there is one
 * the site would fetch (its own storage, or a Google picture), otherwise the
 * first letter on a colour derived from a stable seed. The hues are the
 * website's (oklch 0.55 0.12 across the cyan→magenta arc, 0.54 for the two
 * cyan ones so white on them holds 4.5:1), written as sRGB: never green, amber
 * or red, which mean hired, expiring and rejected beside it.
 */
const HUES = ['#506eb7', '#7d5fad', '#985593', '#007f9a', '#1479b0', '#00847e'];

function hueFor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return HUES[Math.abs(hash) % HUES.length];
}

const SIZES = { sm: 36, md: 44, lg: 64 } as const;

export function Avatar({
  name,
  src,
  seed,
  size = 'sm',
  shape = 'circle',
}: {
  name: string;
  src?: string | null;
  seed?: string;
  size?: keyof typeof SIZES;
  shape?: 'circle' | 'rounded';
}) {
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

  // Hidden, letter and all: `accessible={false}` alone leaves the Text inside
  // to VoiceOver, which read a stray letter before the name beside it.
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ ...frame, alignItems: 'center', justifyContent: 'center', backgroundColor: hueFor(seed || name) }}
    >
      <Text weight="bold" variant={size === 'lg' ? 'title' : 'small'} style={{ color: '#FFFFFF' }}>
        {Array.from(name.trim())[0] ?? '?'}
      </Text>
    </View>
  );
}
