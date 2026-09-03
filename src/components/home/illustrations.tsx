import {
  Accent,
  Avatar,
  BLUE,
  Bloom,
  Card,
  Chip,
  Defs,
  Line,
  LINE,
  MUTED,
  SOFT,
  SURFACE,
  svgProps,
} from './illustration-kit';

/**
 * Section illustrations, drawn rather than sourced.
 *
 * Renders the product's own surface — a profile and the switch that decides
 * who can see it — which keeps it honest about what the section describes and
 * lets it inherit the theme instead of shipping a PNG. Purely decorative, so
 * it is aria-hidden and the prose beside it carries the meaning.
 *
 * Built from illustration-kit, so radii, stroke weights, bar heights and
 * shadows match every other drawing on the site.
 *
 * The listing and pipeline scenes that used to live here are gone: the
 * how-it-works sections they illustrated are now step-by-step, and each step
 * draws its own screen.
 */

/** A profile and the switch that decides who can see it. */
export function VisibilityIllustration({ className }: { className?: string }) {
  const id = 'bc-ill-vis';
  return (
    <svg viewBox="0 0 460 320" className={className} {...svgProps}>
      <Defs id={id} />
      <Bloom id={id} cx={120} cy={80} r={150} />
      <Bloom id={id} cx={370} cy={250} r={120} second />

      {/* The profile card. The name line is deliberately the muted one: this is
          what a gated profile looks like from outside. */}
      <Card id={id} x={26} y={58} w={252} h={204} raised />
      <Avatar cx={64} cy={100} r={20} />
      <Line x={96} y={88} w={104} strong />
      <Line x={96} y={108} w={72} />

      <Chip x={50} y={144} w={78} on />
      <Chip x={138} y={144} w={64} />

      <Line x={50} y={186} w={188} />
      <Line x={50} y={206} w={148} />
      <Line x={50} y={226} w={168} />

      {/* The three visibility settings, the middle one chosen */}
      <Card id={id} x={302} y={78} w={132} h={164} raised />
      <rect x={318} y={96} width={100} height={34} rx={10} fill={MUTED} />
      <circle cx={336} cy={113} r={7} fill={SOFT} opacity={0.3} />
      <Line x={352} y={109} w={50} />

      <Accent id={id} x={318} y={138} w={100} h={34} rx={10} />
      <circle cx={336} cy={155} r={7} fill="white" opacity={0.95} />
      <rect x={352} y={151} width={50} height={7} rx={3.5} fill="white" opacity={0.8} />

      <rect x={318} y={180} width={100} height={34} rx={10} fill={MUTED} />
      <circle cx={336} cy={197} r={7} fill={SOFT} opacity={0.3} />
      <Line x={352} y={193} w={38} />

      {/* The switch itself, sitting between the profile and who sees it */}
      <circle cx={290} cy={60} r={22} fill={SURFACE} stroke={LINE} strokeWidth={1.5} />
      <circle cx={290} cy={60} r={22} fill={BLUE} opacity={0.08} />
      <path
        d="M280 60 a10 7 0 0 1 20 0 a10 7 0 0 1 -20 0"
        fill="none"
        stroke={BLUE}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <circle cx={290} cy={60} r={3} fill={BLUE} />
      <path d="M281 69 l18 -18" stroke={BLUE} strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}
