/**
 * The shared vocabulary every illustration on the site is drawn from.
 *
 * The first set were wireframes: flat grey blocks, hatched placeholder
 * texture, and a grey ellipse under everything standing in for a shadow. They
 * read as something not finished yet.
 *
 * What changed:
 *
 *   - Depth comes from a real shadow filter and layered surfaces, not from an
 *     ellipse on the floor.
 *   - Colour is spent once per drawing. Everything else is the neutral palette,
 *     so the brand gradient always marks the thing the picture is about.
 *   - One corner radius, one stroke weight, one bar height. Consistency across
 *     nine drawings is most of what reads as "considered".
 *   - No hatching, no lorem scribble. A bar is a line of text; a chip has a
 *     width that means something.
 *
 * Everything inherits the theme through CSS variables, so all of it works in
 * dark mode without a second asset.
 */

export const INK = 'var(--foreground)';
export const BLUE = 'var(--brand-blue)';
export const CYAN = 'var(--brand-cyan)';
export const LINE = 'var(--border)';
export const SURFACE = 'var(--card)';
export const MUTED = 'var(--muted)';
export const SOFT = 'var(--muted-foreground)';
export const OK = 'var(--success)';

/** One radius and one stroke, everywhere. */
export const R = 14;
export const STROKE = 1.5;

/**
 * Definitions every drawing needs: the brand gradient, a soft shadow, and two
 * ambient blooms. `id` namespaces them, because two of these can share a page
 * and SVG ids are global.
 */
export function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-brand`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={BLUE} />
        <stop offset="100%" stopColor={CYAN} />
      </linearGradient>

      <radialGradient id={`${id}-bloom`}>
        <stop offset="0%" stopColor={BLUE} stopOpacity="0.20" />
        <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
      </radialGradient>

      <radialGradient id={`${id}-bloom-2`}>
        <stop offset="0%" stopColor={CYAN} stopOpacity="0.22" />
        <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
      </radialGradient>

      {/* Soft and low, the way a card sits on a page rather than floats. */}
      <filter id={`${id}-lift`} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#0f1320" floodOpacity="0.07" />
      </filter>

      <filter id={`${id}-lift-sm`} x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#0f1320" floodOpacity="0.06" />
      </filter>
    </defs>
  );
}

/** Atmosphere behind the subject. Replaces the old floor ellipse. */
export function Bloom({ id, cx, cy, r, second }: { id: string; cx: number; cy: number; r: number; second?: boolean }) {
  return <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-${second ? 'bloom-2' : 'bloom'})`} />;
}

/** A panel. `raised` gets the shadow; nested surfaces do not. */
export function Card({
  id,
  x,
  y,
  w,
  h,
  raised,
  accent,
  fill = SURFACE,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  raised?: boolean;
  accent?: boolean;
  fill?: string;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={R}
      fill={fill}
      stroke={accent ? BLUE : LINE}
      strokeWidth={accent ? 2 : STROKE}
      filter={raised ? `url(#${id}-lift)` : undefined}
    />
  );
}

/** A line of text. Width carries the hierarchy; height never changes. */
export function Line({
  x,
  y,
  w,
  strong,
  color = SOFT,
}: {
  x: number;
  y: number;
  w: number;
  strong?: boolean;
  color?: string;
}) {
  return <rect x={x} y={y} width={w} height={strong ? 9 : 7} rx={4.5} fill={color} opacity={strong ? 0.75 : 0.32} />;
}

/** A pill. `on` is the one that is selected. */
export function Chip({ x, y, w, on }: { x: number; y: number; w: number; on?: boolean }) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={22}
      rx={11}
      fill={on ? BLUE : MUTED}
      opacity={on ? 0.9 : 1}
    />
  );
}

/** The focal element: the one thing per drawing wearing the brand. */
export function Accent({
  id,
  x,
  y,
  w,
  h,
  rx = R,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
}) {
  return <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#${id}-brand)`} filter={`url(#${id}-lift-sm)`} />;
}

export function Avatar({ cx, cy, r = 16, muted }: { cx: number; cy: number; r?: number; muted?: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={muted ? MUTED : BLUE} opacity={muted ? 1 : 0.15} />
      <circle cx={cx} cy={cy - r * 0.18} r={r * 0.3} fill={muted ? SOFT : BLUE} opacity={muted ? 0.35 : 0.75} />
      <path
        d={`M${cx - r * 0.52} ${cy + r * 0.62} a ${r * 0.52} ${r * 0.46} 0 0 1 ${r * 1.04} 0`}
        fill={muted ? SOFT : BLUE}
        opacity={muted ? 0.35 : 0.75}
      />
    </g>
  );
}

/** A tick in a filled circle — used for "done", never for decoration. */
export function Tick({ cx, cy, r = 13, color = OK }: { cx: number; cy: number; r?: number; color?: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <path
        d={`M${cx - r * 0.42} ${cy} l${r * 0.3} ${r * 0.32} l${r * 0.58} -${r * 0.64}`}
        fill="none"
        stroke="white"
        strokeWidth={r * 0.22}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

export const svgProps = {
  role: 'presentation' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};
