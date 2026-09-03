import {
  Accent,
  BLUE,
  Bloom,
  Card,
  Chip,
  CYAN,
  Defs,
  Line,
  MUTED,
  OK,
  SOFT,
  Tick,
  svgProps,
} from './illustration-kit';

/**
 * One drawing per step of the candidate flow, from the same kit as everything
 * else — same radii, same stroke, same bar height, same shadow.
 *
 * Each is the screen its step describes. Decorative to assistive technology;
 * the step text carries the meaning.
 */

const VIEW = '0 0 460 300';

/** Step 1 — the board narrowing to the roles worth reading. */
export function FilterStep({ className }: { className?: string }) {
  const id = 'bc-cand-filter';
  return (
    <svg viewBox={VIEW} className={className} {...svgProps}>
      <Defs id={id} />
      <Bloom id={id} cx={350} cy={64} r={140} />
      <Bloom id={id} cx={70} cy={250} r={110} second />

      {/* The rail, with the salary switch thrown */}
      <Card id={id} x={26} y={34} w={122} h={232} raised />
      <Line x={48} y={58} w={56} strong />
      <Chip x={48} y={80} w={78} on />
      <Chip x={48} y={112} w={78} />
      <Chip x={48} y={144} w={62} />
      <Line x={48} y={184} w={48} strong />
      <rect x={48} y={202} width={78} height={22} rx={11} fill={CYAN} opacity={0.35} />
      <Chip x={48} y={234} w={70} />

      {/* Two matches, the first in focus */}
      <Card id={id} x={174} y={40} w={260} h={104} raised accent />
      <Line x={198} y={66} w={122} strong />
      <Line x={198} y={86} w={84} />
      <rect x={198} y={108} width={96} height={20} rx={10} fill={BLUE} opacity={0.1} />
      <rect x={304} y={108} width={66} height={20} rx={10} fill={CYAN} opacity={0.3} />
      <Accent id={id} x={366} y={60} w={50} h={36} rx={11} />
      <text x={391} y={84} textAnchor="middle" fontSize="15" fontWeight="700" fill="white">
        25
      </text>

      <Card id={id} x={174} y={162} w={260} h={104} />
      <Line x={198} y={188} w={104} />
      <Line x={198} y={208} w={72} />
      <rect x={198} y={230} width={96} height={20} rx={10} fill={MUTED} />
    </svg>
  );
}

/** Step 2 — three fields and an optional CV, and that is the application. */
export function ApplyStep({ className }: { className?: string }) {
  const id = 'bc-cand-apply';
  return (
    <svg viewBox={VIEW} className={className} {...svgProps}>
      <Defs id={id} />
      <Bloom id={id} cx={360} cy={64} r={130} />
      <Bloom id={id} cx={90} cy={250} r={110} second />

      <Card id={id} x={78} y={26} w={276} h={248} raised />
      <Line x={104} y={52} w={100} strong />

      {[86, 132, 178].map((y, index) => (
        <g key={y}>
          <Line x={104} y={y} w={68} />
          <rect x={104} y={y + 14} width={224} height={26} rx={9} fill={MUTED} />
          <Line x={118} y={y + 23} w={[90, 108, 66][index]} color={BLUE} strong />
        </g>
      ))}

      {/* Optional, so it is drawn as optional */}
      <rect
        x={104}
        y={226}
        width={224}
        height={32}
        rx={10}
        fill="none"
        stroke={SOFT}
        strokeWidth={1.5}
        strokeDasharray="6 5"
        opacity={0.4}
      />
      <circle cx={126} cy={242} r={7} fill={CYAN} opacity={0.5} />
      <Line x={142} y={238} w={74} />

      {/* Under a minute */}
      <circle cx={382} cy={64} r={34} fill={`url(#${id}-brand)`} filter={`url(#${id}-lift-sm)`} />
      <path
        d="M382 46 v18 l12 8"
        fill="none"
        stroke="white"
        strokeWidth={5.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Step 3 — the statuses move, and the company writes first. */
export function TrackStep({ className }: { className?: string }) {
  const id = 'bc-cand-track';
  return (
    <svg viewBox={VIEW} className={className} {...svgProps}>
      <Defs id={id} />
      <Bloom id={id} cx={90} cy={64} r={130} />
      <Bloom id={id} cx={370} cy={250} r={120} second />

      <Card id={id} x={26} y={36} w={248} h={228} raised />
      <Line x={50} y={60} w={84} strong />

      {[
        { y: 88, fill: OK, w: 58 },
        { y: 142, fill: BLUE, w: 46 },
        { y: 196, fill: SOFT, w: 52 },
      ].map((row) => (
        <g key={row.y}>
          <rect x={50} y={row.y} width={200} height={42} rx={12} fill={MUTED} />
          <Line x={68} y={row.y + 12} w={88} strong={row.fill !== SOFT} />
          <Line x={68} y={row.y + 27} w={54} />
          <rect
            x={250 - row.w - 14}
            y={row.y + 12}
            width={row.w}
            height={18}
            rx={9}
            fill={row.fill}
            opacity={row.fill === SOFT ? 0.18 : 0.85}
          />
        </g>
      ))}

      {/* The message that actually arrives */}
      <Accent id={id} x={306} y={86} w={126} h={104} rx={16} />
      <rect x={326} y={112} width={82} height={8} rx={4} fill="white" opacity={0.9} />
      <rect x={326} y={130} width={64} height={8} rx={4} fill="white" opacity={0.6} />
      <rect x={326} y={148} width={46} height={8} rx={4} fill="white" opacity={0.4} />

      <Tick cx={306} cy={86} r={15} color={OK} />
    </svg>
  );
}
