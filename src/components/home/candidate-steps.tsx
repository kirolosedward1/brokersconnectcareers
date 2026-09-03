/**
 * One illustration per step of the candidate flow.
 *
 * Same reasoning as the employer set: each picture is the screen its step
 * describes, drawn so it inherits the theme rather than shipping three more
 * PNGs. All decorative — the step text carries the meaning.
 */

const BLUE = 'var(--brand-blue)';
const CYAN = 'var(--brand-cyan)';
const LINE = 'var(--border)';
const SURFACE = 'var(--card)';
const MUTED = 'var(--muted)';
const SOFT = 'var(--muted-foreground)';
const OK = 'var(--success)';

const svgProps = {
  viewBox: '0 0 440 300',
  role: 'presentation' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={BLUE} />
        <stop offset="100%" stopColor={CYAN} />
      </linearGradient>
    </defs>
  );
}

/** Step 1 — narrowing the board down to the roles worth reading. */
export function FilterStep({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <Defs id="bc-cand-filter" />

      {/* The filter rail, with the salary switch thrown */}
      <rect x="24" y="30" width="118" height="240" rx="16" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <rect x="44" y="52" width="56" height="8" rx="4" fill={SOFT} opacity="0.5" />
      <rect x="44" y="76" width="78" height="20" rx="10" fill={BLUE} opacity="0.12" />
      <rect x="44" y="76" width="34" height="20" rx="10" fill={BLUE} />
      <rect x="44" y="108" width="78" height="20" rx="10" fill={MUTED} />
      <rect x="44" y="140" width="78" height="20" rx="10" fill={MUTED} />
      <rect x="44" y="176" width="56" height="8" rx="4" fill={SOFT} opacity="0.5" />
      <rect x="44" y="196" width="78" height="20" rx="10" fill={CYAN} opacity="0.45" />
      <rect x="44" y="228" width="78" height="20" rx="10" fill={MUTED} />

      {/* Two matching listings, the first in focus */}
      <rect x="166" y="42" width="250" height="96" rx="16" fill={SURFACE} stroke={BLUE} strokeWidth="2.5" />
      <rect x="188" y="66" width="116" height="10" rx="5" fill={SOFT} />
      <rect x="188" y="86" width="80" height="8" rx="4" fill={SOFT} opacity="0.4" />
      <rect x="188" y="108" width="92" height="16" rx="8" fill={BLUE} opacity="0.12" />
      <rect x="292" y="108" width="64" height="16" rx="8" fill={CYAN} opacity="0.35" />
      <rect x="344" y="62" width="52" height="36" rx="10" fill="url(#bc-cand-filter-g)" />
      <text x="370" y="86" textAnchor="middle" fontSize="15" fontWeight="700" fill="white">
        25
      </text>

      <rect x="166" y="156" width="250" height="96" rx="16" fill={SURFACE} stroke={LINE} strokeWidth="2" opacity="0.7" />
      <rect x="188" y="180" width="96" height="10" rx="5" fill={SOFT} opacity="0.5" />
      <rect x="188" y="200" width="70" height="8" rx="4" fill={SOFT} opacity="0.3" />
      <rect x="188" y="222" width="92" height="16" rx="8" fill={MUTED} />
    </svg>
  );
}

/** Step 2 — three fields and a CV, and that is the whole application. */
export function ApplyStep({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <Defs id="bc-cand-apply" />

      <rect x="88" y="26" width="264" height="248" rx="18" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <rect x="112" y="52" width="96" height="10" rx="5" fill={SOFT} />

      {[86, 132, 178].map((y, index) => (
        <g key={y}>
          <rect x="112" y={y} width="70" height="7" rx="3.5" fill={SOFT} opacity="0.4" />
          <rect x="112" y={y + 14} width="216" height="24" rx="8" fill={MUTED} />
          <rect
            x="124"
            y={y + 22}
            width={[86, 104, 62][index]}
            height="8"
            rx="4"
            fill={BLUE}
            opacity="0.45"
          />
        </g>
      ))}

      {/* The CV is optional — dashed, not required */}
      <rect
        x="112"
        y="222"
        width="216"
        height="30"
        rx="10"
        fill="none"
        stroke={LINE}
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      <circle cx="134" cy="237" r="7" fill={CYAN} opacity="0.5" />
      <rect x="150" y="233" width="72" height="7" rx="3.5" fill={SOFT} opacity="0.35" />

      {/* Under a minute */}
      <circle cx="372" cy="70" r="34" fill="url(#bc-cand-apply-g)" />
      <path d="M372 52 v20 l13 8" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Step 3 — the employer comes to you, on WhatsApp. */
export function TrackStep({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <Defs id="bc-cand-track" />

      <rect x="24" y="40" width="236" height="220" rx="18" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <rect x="46" y="64" width="80" height="9" rx="4.5" fill={SOFT} opacity="0.5" />

      {[
        { y: 92, fill: OK, w: 62 },
        { y: 146, fill: BLUE, w: 48 },
        { y: 200, fill: SOFT, w: 54 },
      ].map((row) => (
        <g key={row.y}>
          <rect x="46" y={row.y} width="192" height="40" rx="12" fill={MUTED} />
          <rect x="62" y={row.y + 12} width="84" height="8" rx="4" fill={SOFT} opacity="0.45" />
          <rect x="62" y={row.y + 25} width="52" height="6" rx="3" fill={SOFT} opacity="0.25" />
          <rect
            x={238 - row.w - 12}
            y={row.y + 12}
            width={row.w}
            height="16"
            rx="8"
            fill={row.fill}
            opacity={row.fill === SOFT ? 0.25 : 0.85}
          />
        </g>
      ))}

      {/* The message that actually arrives */}
      <path
        d="M292 92 h108 a16 16 0 0 1 16 16 v66 a16 16 0 0 1 -16 16 h-78 l-22 22 v-22 h-8 a16 16 0 0 1 -16 -16 v-66 a16 16 0 0 1 16 -16 z"
        fill="url(#bc-cand-track-g)"
      />
      <rect x="308" y="116" width="74" height="8" rx="4" fill="white" opacity="0.9" />
      <rect x="308" y="134" width="58" height="8" rx="4" fill="white" opacity="0.65" />
      <rect x="308" y="152" width="44" height="8" rx="4" fill="white" opacity="0.45" />
    </svg>
  );
}
