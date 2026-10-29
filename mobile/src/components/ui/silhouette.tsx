import Svg, { Circle, Path } from 'react-native-svg';

/**
 * The generic figures drawn where there is no picture: a person without a
 * photo, a company without a logo — the same for everyone, never a letter or
 * a colour of its own (v1.1). The glyphs are the design's; the tile behind
 * them, and its colour, are the caller's. Hidden from VoiceOver, as the name
 * beside it says who it is.
 */
export function PersonGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} testID="person-silhouette">
      <Circle cx={12} cy={8.5} r={4} fill={color} />
      <Path d="M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5z" fill={color} />
    </Svg>
  );
}

/** A building, drawn in outline: its door and a row of windows. */
export function BuildingGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} testID="building-silhouette">
      <Path
        d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 11h.01M15 11h.01M12 11h.01"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
