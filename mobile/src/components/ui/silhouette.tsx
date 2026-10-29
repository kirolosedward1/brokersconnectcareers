import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '~/theme/provider';

/**
 * The generic figures drawn where there is no picture: a person without a
 * photo, a company without a logo. The same quiet grey for everyone — never
 * a letter or a colour of its own, which read as somebody's initials or as a
 * status beside them. Drawn to fill the frame it is put in (a circle, a
 * tile), which clips it; hidden from VoiceOver, as the name beside it says
 * who it is.
 */
export function PersonSilhouette({ size }: { size: number }) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false} testID="person-silhouette">
      <Rect width={100} height={100} fill={colors.muted} />
      <Circle cx={50} cy={39} r={18} fill={colors.mutedForeground} fillOpacity={0.45} />
      <Path d="M13 100c0-22 17-36 37-36s37 14 37 36z" fill={colors.mutedForeground} fillOpacity={0.45} />
    </Svg>
  );
}

/** A building: a tower with its windows, and a lower wing beside it. */
export function BuildingSilhouette({ size }: { size: number }) {
  const { colors } = useTheme();
  const ink = colors.mutedForeground;
  const windows = [36, 50, 64].flatMap((y) => [38, 52].map((x) => ({ x, y })));
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false} testID="building-silhouette">
      <Rect width={100} height={100} fill={colors.muted} />
      <Rect x={30} y={24} width={34} height={56} rx={3} fill={ink} fillOpacity={0.45} />
      <Rect x={64} y={46} width={16} height={34} rx={2} fill={ink} fillOpacity={0.3} />
      {windows.map(({ x, y }) => (
        <Rect key={`${x}:${y}`} x={x} y={y} width={6} height={7} rx={1} fill={colors.muted} />
      ))}
      <Rect x={20} y={80} width={60} height={3} rx={1.5} fill={ink} fillOpacity={0.45} />
    </Svg>
  );
}
