import {
  Accent,
  Avatar,
  BLUE,
  Bloom,
  Card,
  Chip,
  CYAN,
  Defs,
  Line,
  MUTED,
  SOFT,
  SURFACE,
  Tick,
  svgProps,
} from './illustration-kit';

/**
 * One drawing per step of the hiring flow, built from illustration-kit so the
 * radii, stroke weights, bar heights and shadows match everything else.
 *
 * Each shows the screen its step describes, so the picture is a claim about
 * the product rather than decoration beside one. All decorative to assistive
 * technology; the step text carries the meaning.
 */

const VIEW = '0 0 460 300';

/** Step 1 — the register and tax card go up, the badge comes back. */
export function VerifyStep({ className }: { className?: string }) {
  const id = 'bc-step-verify';
  return (
    <svg viewBox={VIEW} className={className} {...svgProps}>
      <Defs id={id} />
      <Bloom id={id} cx={330} cy={70} r={140} />
      <Bloom id={id} cx={80} cy={250} r={110} second />

      {/* Two documents, the second on top */}
      <Card id={id} x={38} y={32} w={140} h={184} />
      <Card id={id} x={58} y={54} w={148} h={196} raised accent />

      <Line x={80} y={80} w={72} strong />
      <Line x={80} y={100} w={104} />
      <Line x={80} y={120} w={88} />

      <rect x={80} y={146} width={104} height={36} rx={10} fill={BLUE} opacity={0.07} />
      <circle cx={98} cy={164} r={8} fill={BLUE} opacity={0.9} />
      <Line x={114} y={160} w={54} color={BLUE} />

      <Chip x={80} y={198} w={56} />
      <Chip x={144} y={198} w={40} />

      {/* The badge the step earns */}
      <circle cx={296} cy={128} r={52} fill={`url(#${id}-brand)`} filter={`url(#${id}-lift)`} />
      <path
        d="M274 128 l15 16 l30 -33"
        fill="none"
        stroke="white"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* A raised posting cap, as three slots filling up */}
      <Card id={id} x={366} y={82} w={64} h={122} raised />
      <rect x={382} y={100} width={32} height={16} rx={8} fill={MUTED} />
      <rect x={382} y={126} width={32} height={16} rx={8} fill={CYAN} opacity={0.4} />
      <Accent id={id} x={382} y={152} w={32} h={16} rx={8} />
      <Line x={382} y={180} w={32} />
    </svg>
  );
}

/** Step 2 — the three fields the form will not publish without. */
export function PostStep({ className }: { className?: string }) {
  const id = 'bc-step-post';
  return (
    <svg viewBox={VIEW} className={className} {...svgProps}>
      <Defs id={id} />
      <Bloom id={id} cx={110} cy={60} r={130} />
      <Bloom id={id} cx={370} cy={250} r={120} second />

      <Card id={id} x={44} y={30} w={306} h={240} raised />
      <Line x={70} y={56} w={96} strong />
      <Line x={70} y={76} w={62} />

      {[104, 156, 208].map((y, index) => (
        <g key={y}>
          <rect x={70} y={y} width={200} height={38} rx={11} fill={BLUE} opacity={0.06} />
          <Line x={88} y={y + 15} w={[112, 134, 96][index]} color={BLUE} strong />
          <Tick cx={296} cy={y + 19} r={12} />
        </g>
      ))}

      {/* Seats, the number candidates filter on */}
      <Card id={id} x={366} y={78} w={66} h={144} raised />
      <Accent id={id} x={380} y={92} w={38} h={70} rx={12} />
      <text x={399} y={135} textAnchor="middle" fontSize="17" fontWeight="700" fill="white">
        25
      </text>
      <Line x={380} y={178} w={38} />
      <Line x={380} y={196} w={26} />
    </svg>
  );
}

/** Step 3 — one list, and the message already written. */
export function ContactStep({ className }: { className?: string }) {
  const id = 'bc-step-contact';
  return (
    <svg viewBox={VIEW} className={className} {...svgProps}>
      <Defs id={id} />
      <Bloom id={id} cx={90} cy={70} r={130} />
      <Bloom id={id} cx={380} cy={240} r={120} second />

      <Card id={id} x={30} y={34} w={272} h={232} raised />
      <Line x={54} y={58} w={80} strong />

      {[88, 142, 196].map((y, index) => (
        <g key={y}>
          <rect
            x={54}
            y={y}
            width={224}
            height={42}
            rx={12}
            fill={index === 0 ? SURFACE : MUTED}
            stroke={index === 0 ? BLUE : 'none'}
            strokeWidth={2}
          />
          <Avatar cx={78} cy={y + 21} r={12} muted={index !== 0} />
          <Line x={98} y={y + 12} w={82} strong={index === 0} />
          <Line x={98} y={y + 27} w={52} />
          <rect
            x={216}
            y={y + 12}
            width={46}
            height={18}
            rx={9}
            fill={index === 0 ? BLUE : SOFT}
            opacity={index === 0 ? 0.85 : 0.16}
          />
        </g>
      ))}

      {/* The WhatsApp opener */}
      <Accent id={id} x={324} y={70} w={112} h={96} rx={16} />
      <rect x={342} y={94} width={76} height={8} rx={4} fill="white" opacity={0.9} />
      <rect x={342} y={112} width={58} height={8} rx={4} fill="white" opacity={0.6} />
      <rect x={342} y={130} width={42} height={8} rx={4} fill="white" opacity={0.4} />

      {/* The CV, behind a short-lived link */}
      <Card id={id} x={330} y={188} w={100} h={62} raised />
      <Line x={348} y={208} w={52} />
      <Line x={348} y={226} w={36} />
      <Tick cx={430} cy={188} r={14} color={BLUE} />
    </svg>
  );
}
