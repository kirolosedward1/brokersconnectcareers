/**
 * One illustration per step of the hiring flow.
 *
 * Drawn, not sourced, for the same reasons as the section illustrations: they
 * render the product's own surfaces, they inherit the theme through CSS
 * variables instead of shipping three more PNGs, and they stay sharp at any
 * size. Each one shows the screen the step actually describes, so the picture
 * is a claim about the product rather than decoration next to one.
 *
 * All three are aria-hidden; the step text beside them carries the meaning.
 */

const BLUE = 'var(--brand-blue)';
const CYAN = 'var(--brand-cyan)';
const LINE = 'var(--border)';
const SURFACE = 'var(--card)';
const MUTED = 'var(--muted)';
const SOFT = 'var(--muted-foreground)';
const OK = 'var(--success)';

function Frame({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={BLUE} />
          <stop offset="100%" stopColor={CYAN} />
        </linearGradient>
      </defs>
      <ellipse cx="240" cy="326" rx="190" ry="16" fill={MUTED} />
      {children}
    </>
  );
}

const svgProps = {
  viewBox: '0 0 480 350',
  role: 'presentation' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

/** Step 1 — the commercial register and tax card going up for review. */
export function VerifyStep({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <Frame id="bc-step-verify">
        {/* Two documents, the second already approved */}
        <rect x="58" y="52" width="150" height="196" rx="14" fill={SURFACE} stroke={LINE} strokeWidth="2" opacity="0.55" />
        <rect x="86" y="74" width="150" height="196" rx="14" fill={SURFACE} stroke={BLUE} strokeWidth="2.5" />

        <rect x="110" y="100" width="74" height="9" rx="4.5" fill={SOFT} />
        <rect x="110" y="120" width="102" height="7" rx="3.5" fill={SOFT} opacity="0.4" />
        <rect x="110" y="140" width="88" height="7" rx="3.5" fill={SOFT} opacity="0.4" />

        <rect x="110" y="166" width="102" height="34" rx="10" fill={BLUE} opacity="0.08" />
        <circle cx="128" cy="183" r="8" fill={BLUE} />
        <rect x="144" y="179" width="54" height="7" rx="3.5" fill={BLUE} opacity="0.65" />

        <rect x="110" y="216" width="60" height="8" rx="4" fill={MUTED} />
        <rect x="178" y="216" width="34" height="8" rx="4" fill={MUTED} />

        {/* The verified badge — the thing the step earns you */}
        <circle cx="300" cy="150" r="58" fill="url(#bc-step-verify-g)" />
        <path
          d="M276 150 l16 17 l32 -35"
          fill="none"
          stroke="white"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="252" y="228" width="96" height="12" rx="6" fill={BLUE} opacity="0.22" />
        <rect x="268" y="252" width="64" height="9" rx="4.5" fill={SOFT} opacity="0.35" />

        {/* A raised posting cap, implied by three stacked slots */}
        <rect x="368" y="112" width="58" height="18" rx="9" fill={MUTED} />
        <rect x="368" y="140" width="58" height="18" rx="9" fill={CYAN} opacity="0.4" />
        <rect x="368" y="168" width="58" height="18" rx="9" fill={BLUE} opacity="0.75" />
      </Frame>
    </svg>
  );
}

/** Step 2 — the three fields the form insists on. */
export function PostStep({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <Frame id="bc-step-post">
        <rect x="70" y="44" width="340" height="248" rx="18" fill={SURFACE} stroke={LINE} strokeWidth="2" />
        <rect x="70" y="44" width="340" height="46" rx="18" fill={MUTED} />
        <rect x="70" y="76" width="340" height="14" fill={MUTED} />
        <rect x="94" y="60" width="104" height="10" rx="5" fill={SOFT} opacity="0.55" />

        {/* Three required rows, each ticked */}
        {[
          { y: 116, w: 128 },
          { y: 168, w: 150 },
          { y: 220, w: 112 },
        ].map((row, index) => (
          <g key={row.y}>
            <rect x="96" y={row.y} width="212" height="36" rx="10" fill={BLUE} opacity="0.07" />
            <rect x="112" y={row.y + 14} width={row.w} height="8" rx="4" fill={BLUE} opacity={0.5 + index * 0.15} />
            <circle cx={330} cy={row.y + 18} r="13" fill={OK} opacity="0.15" />
            <path
              d={`M${324} ${row.y + 18} l4 4.5 l8 -9`}
              fill="none"
              stroke={OK}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {/* Seats, the number candidates filter on */}
        <rect x="352" y="112" width="40" height="148" rx="12" fill="url(#bc-step-post-g)" opacity="0.9" />
        <text x="372" y="176" textAnchor="middle" fontSize="20" fontWeight="700" fill="white">
          25
        </text>
        <rect x="360" y="188" width="24" height="5" rx="2.5" fill="white" opacity="0.7" />
      </Frame>
    </svg>
  );
}

/** Step 3 — one list, one conversation per applicant. */
export function ContactStep({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <Frame id="bc-step-contact">
        <rect x="58" y="52" width="268" height="220" rx="18" fill={SURFACE} stroke={LINE} strokeWidth="2" />

        {[70, 128, 186].map((y, index) => (
          <g key={y}>
            <rect
              x="80"
              y={y + 8}
              width="224"
              height="46"
              rx="12"
              fill={index === 0 ? SURFACE : MUTED}
              stroke={index === 0 ? BLUE : 'none'}
              strokeWidth="2.5"
            />
            <circle cx="106" cy={y + 31} r="13" fill={index === 0 ? BLUE : SOFT} opacity={index === 0 ? 1 : 0.3} />
            <rect x="128" y={y + 22} width="84" height="7" rx="3.5" fill={SOFT} opacity="0.55" />
            <rect x="128" y={y + 36} width="52" height="6" rx="3" fill={SOFT} opacity="0.3" />
            <rect
              x="238"
              y={y + 24}
              width="52"
              height="16"
              rx="8"
              fill={index === 0 ? BLUE : SOFT}
              opacity={index === 0 ? 0.85 : 0.18}
            />
          </g>
        ))}

        {/* The WhatsApp message, already written */}
        <path
          d="M348 96 h96 a14 14 0 0 1 14 14 v58 a14 14 0 0 1 -14 14 h-70 l-20 20 v-20 h-6 a14 14 0 0 1 -14 -14 v-58 a14 14 0 0 1 14 -14 z"
          fill="url(#bc-step-contact-g)"
        />
        <rect x="362" y="118" width="66" height="7" rx="3.5" fill="white" opacity="0.9" />
        <rect x="362" y="134" width="52" height="7" rx="3.5" fill="white" opacity="0.65" />
        <rect x="362" y="150" width="40" height="7" rx="3.5" fill="white" opacity="0.45" />

        {/* The CV, behind a short-lived link */}
        <rect x="352" y="212" width="72" height="56" rx="12" fill={SURFACE} stroke={LINE} strokeWidth="2" />
        <rect x="368" y="230" width="40" height="6" rx="3" fill={SOFT} opacity="0.45" />
        <rect x="368" y="242" width="28" height="6" rx="3" fill={SOFT} opacity="0.3" />
        <circle cx="424" cy="212" r="14" fill={OK} />
        <path
          d="M418 212 l4 4.5 l8 -9"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Frame>
    </svg>
  );
}
