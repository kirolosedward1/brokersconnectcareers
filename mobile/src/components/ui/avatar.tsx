import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { trustedAvatarUrl } from '@/lib/avatar-url';
import { env } from '~/lib/env';
import { Text } from './text';

/**
 * A person, as a circle — the website's Avatar: the photo when there is one
 * the site would fetch (its own storage, or a Google picture), otherwise the
 * first letter on a colour derived from a stable seed. The hues are the
 * website's (oklch 0.55 0.12 across the cyan→magenta arc), written as sRGB:
 * never green, amber or red, which mean hired, expiring and rejected beside it.
 */
const HUES = ['#506eb7', '#7d5fad', '#985593', '#00829d', '#1479b0', '#008781'];

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
}: {
  name: string;
  src?: string | null;
  seed?: string;
  size?: keyof typeof SIZES;
}) {
  const px = SIZES[size];
  const photo = trustedAvatarUrl(src, env.supabaseUrl);
  // Which photo failed, not whether one did: a list reuses this component for
  // other people as it scrolls, and a failure must not follow the row.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const shape = { width: px, height: px, borderRadius: px / 2, overflow: 'hidden' as const };

  if (photo && failedPhoto !== photo) {
    return (
      <View accessible={false} style={shape}>
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
      accessible={false}
      style={{ ...shape, alignItems: 'center', justifyContent: 'center', backgroundColor: hueFor(seed || name) }}
    >
      <Text weight="bold" variant={size === 'lg' ? 'title' : 'small'} style={{ color: '#FFFFFF' }}>
        {Array.from(name.trim())[0] ?? '?'}
      </Text>
    </View>
  );
}
