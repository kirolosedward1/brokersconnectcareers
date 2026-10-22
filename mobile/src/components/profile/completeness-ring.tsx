import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { useTranslations } from 'use-intl';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';

/** The ring's thickness, and the room between it and the photo. */
const STROKE = 3;
const GAP = 3;

/** How far round the ring goes for a percentage: the whole way at 100, never past it. */
export function ringShare(percent: number): number {
  return Math.max(0, Math.min(100, percent)) / 100;
}

/**
 * The reader's photo with how complete their profile is drawn round it, as
 * the stories ring on a photo is: champagne for the part done, a faint track
 * for the rest. A tap opens the profile, where the next thing missing heads
 * the list (ProfileGaps). Nothing is drawn round it until the percentage is
 * known — a ring that fills in late looked like progress being made.
 *
 * `size` is the photo's, `radius` its corners' (half the size for a circle).
 */
export function CompletenessRing({
  percent,
  size,
  radius,
  onPress,
  children,
}: {
  percent: number | null;
  size: number;
  radius: number;
  onPress: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('app.profile');
  const { colors } = useTheme();
  if (percent === null) return <>{children}</>;

  const box = size + (GAP + STROKE) * 2;
  const inset = STROKE / 2;
  const side = box - STROKE;
  const corner = radius + GAP + inset;
  // The path's length round a rounded rectangle: its straight sides and its four quarter turns.
  const length = 4 * (side - 2 * corner) + 2 * Math.PI * corner;
  const done = length * ringShare(percent);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.markup('ringLabel', { percent, ...markupTags })}
      accessibilityHint={t('ringHint')}
      onPress={onPress}
      testID="completeness-ring"
      style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={box} height={box} style={{ position: 'absolute' }}>
        <Rect x={inset} y={inset} width={side} height={side} rx={corner} stroke={colors.border} strokeWidth={STROKE} fill="none" />
        {done > 0 ? (
          <Rect
            x={inset}
            y={inset}
            width={side}
            height={side}
            rx={corner}
            stroke={colors.champagne}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${done} ${length}`}
            fill="none"
          />
        ) : null}
      </Svg>
      <View accessible={false}>{children}</View>
    </Pressable>
  );
}
