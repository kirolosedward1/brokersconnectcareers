/**
 * Section illustrations, drawn rather than sourced.
 *
 * They render the product's own surfaces — a listing with its compensation row,
 * an applicant pipeline — which keeps them honest about what the tab describes
 * and lets them inherit the theme instead of shipping two more PNGs. Purely
 * decorative, so every one of them is aria-hidden and the prose beside it
 * carries the meaning.
 */

const BLUE = 'var(--brand-blue)';
const CYAN = 'var(--brand-cyan)';
const LINE = 'var(--border)';
const SURFACE = 'var(--card)';
const MUTED = 'var(--muted)';
const SOFT = 'var(--muted-foreground)';

/** A job listing being filtered — what a candidate actually does here. */
export function CandidateIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 300" className={className} role="presentation" aria-hidden focusable="false">
      <defs>
        <linearGradient id="bc-cand-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={BLUE} />
          <stop offset="100%" stopColor={CYAN} />
        </linearGradient>
      </defs>

      <ellipse cx="210" cy="268" rx="170" ry="18" fill={MUTED} />

      {/* Filter rail */}
      <rect x="16" y="52" width="104" height="176" rx="14" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <rect x="32" y="70" width="52" height="7" rx="3.5" fill={SOFT} opacity="0.5" />
      <rect x="32" y="90" width="72" height="18" rx="9" fill={BLUE} opacity="0.14" />
      <rect x="32" y="90" width="30" height="18" rx="9" fill={BLUE} />
      <rect x="32" y="118" width="72" height="18" rx="9" fill={MUTED} />
      <rect x="32" y="146" width="72" height="18" rx="9" fill={MUTED} />
      <rect x="32" y="174" width="52" height="18" rx="9" fill={MUTED} />
      <rect x="32" y="202" width="60" height="10" rx="5" fill={CYAN} opacity="0.55" />

      {/* Cards stacked behind */}
      <rect x="148" y="34" width="252" height="60" rx="16" fill={SURFACE} stroke={LINE} strokeWidth="2" opacity="0.55" />
      <rect x="140" y="46" width="264" height="66" rx="16" fill={SURFACE} stroke={LINE} strokeWidth="2" opacity="0.8" />

      {/* The listing in focus */}
      <rect x="132" y="66" width="276" height="162" rx="18" fill={SURFACE} stroke={BLUE} strokeWidth="2.5" />
      <rect x="152" y="88" width="122" height="10" rx="5" fill={SOFT} />
      <rect x="152" y="108" width="86" height="8" rx="4" fill={SOFT} opacity="0.45" />

      {/* Seats badge — the number this market reads first */}
      <rect x="330" y="84" width="58" height="42" rx="12" fill="url(#bc-cand-grad)" />
      <text x="359" y="103" textAnchor="middle" fontSize="17" fontWeight="700" fill="white">25</text>
      <rect x="341" y="110" width="36" height="5" rx="2.5" fill="white" opacity="0.75" />

      {/* Compensation row */}
      <rect x="152" y="136" width="236" height="40" rx="12" fill={BLUE} opacity="0.08" />
      <circle cx="172" cy="156" r="9" fill={BLUE} />
      <rect x="190" y="147" width="92" height="8" rx="4" fill={BLUE} />
      <rect x="190" y="161" width="60" height="6" rx="3" fill={BLUE} opacity="0.5" />

      {/* Leads-source chip */}
      <rect x="152" y="190" width="96" height="20" rx="10" fill={CYAN} opacity="0.35" />
      <rect x="164" y="197" width="60" height="6" rx="3" fill={BLUE} opacity="0.65" />
      <rect x="258" y="190" width="64" height="20" rx="10" fill={MUTED} />

      {/* Magnifier */}
      <circle cx="322" cy="212" r="30" fill={SURFACE} stroke={BLUE} strokeWidth="5" />
      <circle cx="322" cy="212" r="30" fill={CYAN} opacity="0.18" />
      <rect
        x="344"
        y="234"
        width="34"
        height="9"
        rx="4.5"
        fill={BLUE}
        transform="rotate(42 344 234)"
      />
    </svg>
  );
}

/** An applicant pipeline with a message going out — the employer's side. */
export function EmployerIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 300" className={className} role="presentation" aria-hidden focusable="false">
      <defs>
        <linearGradient id="bc-emp-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={BLUE} />
          <stop offset="100%" stopColor={CYAN} />
        </linearGradient>
      </defs>

      <ellipse cx="210" cy="268" rx="170" ry="18" fill={MUTED} />

      {/* Pipeline panel */}
      <rect x="24" y="34" width="256" height="212" rx="18" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <rect x="44" y="56" width="86" height="9" rx="4.5" fill={SOFT} />
      <rect x="212" y="54" width="48" height="14" rx="7" fill={BLUE} opacity="0.15" />

      {[0, 1, 2].map((row) => {
        const y = 88 + row * 52;
        const statusFill = row === 0 ? BLUE : row === 1 ? CYAN : MUTED;
        return (
          <g key={row}>
            <rect x="44" y={y} width="216" height="40" rx="12" fill={MUTED} opacity={row === 0 ? 0 : 0.55} />
            <rect
              x="44"
              y={y}
              width="216"
              height="40"
              rx="12"
              fill="none"
              stroke={row === 0 ? BLUE : LINE}
              strokeWidth={row === 0 ? 2.5 : 1.5}
            />
            <circle cx="68" cy={y + 20} r="12" fill={row === 0 ? BLUE : SOFT} opacity={row === 0 ? 1 : 0.35} />
            <circle cx="68" cy={y + 16} r="4.5" fill={SURFACE} />
            <path d={`M60 ${y + 28} a8 8 0 0 1 16 0`} fill={SURFACE} />
            <rect x="90" y={y + 12} width="74" height="7" rx="3.5" fill={SOFT} opacity="0.75" />
            <rect x="90" y={y + 24} width="46" height="6" rx="3" fill={SOFT} opacity="0.4" />
            <rect x="196" y={y + 13} width="48" height="15" rx="7.5" fill={statusFill} opacity={row === 2 ? 1 : 0.25} />
          </g>
        );
      })}

      {/* Outbound message */}
      <rect x="286" y="96" width="112" height="76" rx="18" fill="url(#bc-emp-grad)" />
      <path d="M300 172 l0 22 l22 -22 z" fill={CYAN} />
      <rect x="304" y="118" width="76" height="8" rx="4" fill="white" opacity="0.9" />
      <rect x="304" y="134" width="58" height="8" rx="4" fill="white" opacity="0.65" />
      <rect x="304" y="150" width="42" height="8" rx="4" fill="white" opacity="0.45" />

      {/* Verified badge */}
      <circle cx="352" cy="216" r="26" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <circle cx="352" cy="216" r="19" fill={BLUE} opacity="0.12" />
      <path
        d="M343 216 l6 6 l13 -13"
        fill="none"
        stroke={BLUE}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The visibility control itself: a profile whose identity is masked, next to
 * the three settings that decide who sees it. Drawn rather than mocked up in
 * markup, because a fake card built from real components invites the reader to
 * try clicking it.
 */
export function VisibilityIllustration({ className }: { className?: string }) {
  const rows = [
    { y: 72, selected: false },
    { y: 128, selected: false },
    { y: 184, selected: true },
  ];

  return (
    <svg viewBox="0 0 420 300" className={className} role="presentation" aria-hidden focusable="false">
      <defs>
        <linearGradient id="bc-vis-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={BLUE} />
          <stop offset="100%" stopColor={CYAN} />
        </linearGradient>
        <pattern id="bc-vis-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill={MUTED} />
          <rect width="3" height="8" fill={SOFT} opacity="0.28" />
        </pattern>
      </defs>

      <ellipse cx="210" cy="272" rx="165" ry="16" fill={MUTED} />

      {/* The profile, with identity withheld */}
      <rect x="24" y="52" width="220" height="184" rx="20" fill={SURFACE} stroke={LINE} strokeWidth="2" />

      <circle cx="70" cy="98" r="24" fill={MUTED} />
      <circle cx="70" cy="90" r="8.5" fill={SOFT} opacity="0.35" />
      <path d="M55 112 a15 15 0 0 1 30 0" fill={SOFT} opacity="0.35" />

      {/* Masked name and contact */}
      <rect x="108" y="84" width="104" height="12" rx="6" fill="url(#bc-vis-hatch)" />
      <rect x="108" y="104" width="68" height="9" rx="4.5" fill={SOFT} opacity="0.3" />

      {/* What a visitor does still see */}
      <rect x="48" y="146" width="70" height="22" rx="11" fill={BLUE} opacity="0.16" />
      <rect x="62" y="154" width="42" height="6" rx="3" fill={BLUE} opacity="0.7" />
      <rect x="126" y="146" width="62" height="22" rx="11" fill={MUTED} />
      <rect x="138" y="154" width="38" height="6" rx="3" fill={SOFT} opacity="0.4" />

      <circle cx="56" cy="192" r="5" fill={CYAN} />
      <rect x="70" y="187" width="88" height="8" rx="4" fill={SOFT} opacity="0.35" />
      <rect x="48" y="210" width="150" height="7" rx="3.5" fill={SOFT} opacity="0.2" />

      {/* Eye-off badge sitting over the card corner */}
      <circle cx="238" cy="66" r="24" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <circle cx="238" cy="66" r="17" fill="url(#bc-vis-grad)" />
      <path
        d="M228 66 c4 -6 16 -6 20 0 c-4 6 -16 6 -20 0 z"
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="238" cy="66" r="3" fill="white" />
      <path d="M228 76 l20 -20" stroke="white" strokeWidth="2.8" strokeLinecap="round" />

      {/* The three visibility settings */}
      <rect x="272" y="52" width="124" height="184" rx="20" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      {rows.map((row) => (
        <g key={row.y}>
          <rect
            x="288"
            y={row.y}
            width="92"
            height="40"
            rx="12"
            fill={row.selected ? 'url(#bc-vis-grad)' : MUTED}
          />
          <circle cx="308" cy={row.y + 20} r="8" fill="white" opacity={row.selected ? 0.95 : 0.75} />
          <rect
            x="324"
            y={row.y + 16}
            width={row.selected ? 44 : 36}
            height="7"
            rx="3.5"
            fill={row.selected ? 'white' : SOFT}
            opacity={row.selected ? 0.9 : 0.45}
          />
        </g>
      ))}
    </svg>
  );
}
