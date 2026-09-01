/**
 * Cover art for blog posts, drawn rather than sourced.
 *
 * Same reasoning as the section illustrations: these inherit the theme through
 * CSS variables instead of shipping a photograph per post, they stay sharp at
 * any size, and they cost a few hundred bytes each instead of a few hundred
 * kilobytes. Stock photography of people shaking hands in offices would say
 * nothing about an article on how commission is structured.
 *
 * A post picks its variant with a `cover:` line in its frontmatter. Without
 * one it gets a stable variant derived from the slug — the same post always
 * draws the same cover, so a reader who has seen it before recognises it in a
 * list, and nothing shifts between server and client render.
 */

const BLUE = 'var(--brand-blue)';
const CYAN = 'var(--brand-cyan)';
const LINE = 'var(--border)';
const SURFACE = 'var(--card)';
const MUTED = 'var(--muted)';
const SOFT = 'var(--muted-foreground)';

export const COVER_VARIANTS = ['listing', 'compare', 'skyline', 'ladder'] as const;
export type CoverVariant = (typeof COVER_VARIANTS)[number];

/**
 * FNV-1a. Small, stable, and — unlike anything seeded from Math.random or the
 * clock — guaranteed to produce the same answer on the server and in the
 * browser, which is the whole requirement here.
 */
function pickVariant(seed: string): CoverVariant {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return COVER_VARIANTS[hash % COVER_VARIANTS.length];
}

function Frame({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={BLUE} />
          <stop offset="100%" stopColor={CYAN} />
        </linearGradient>
        <linearGradient id={`${id}-wash`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.10" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <rect width="400" height="220" fill={`url(#${id}-wash)`} />
      {children}
    </>
  );
}

/** A job listing with its terms filled in — the thing the board is about. */
function Listing({ id }: { id: string }) {
  return (
    <Frame id={id}>
      <rect x="86" y="26" width="228" height="52" rx="14" fill={SURFACE} stroke={LINE} strokeWidth="2" opacity="0.6" />
      <rect x="74" y="44" width="252" height="150" rx="18" fill={SURFACE} stroke={BLUE} strokeWidth="2.5" />

      <rect x="96" y="66" width="112" height="11" rx="5.5" fill={SOFT} />
      <rect x="96" y="86" width="74" height="8" rx="4" fill={SOFT} opacity="0.45" />

      <rect x="248" y="62" width="56" height="38" rx="11" fill={`url(#${id}-g)`} />
      <rect x="259" y="74" width="34" height="6" rx="3" fill="white" opacity="0.9" />
      <rect x="264" y="86" width="24" height="5" rx="2.5" fill="white" opacity="0.6" />

      <rect x="96" y="112" width="208" height="34" rx="11" fill={BLUE} opacity="0.09" />
      <circle cx="114" cy="129" r="8" fill={BLUE} />
      <rect x="130" y="121" width="86" height="7" rx="3.5" fill={BLUE} />
      <rect x="130" y="134" width="56" height="6" rx="3" fill={BLUE} opacity="0.5" />

      <rect x="96" y="158" width="84" height="18" rx="9" fill={CYAN} opacity="0.35" />
      <rect x="190" y="158" width="60" height="18" rx="9" fill={MUTED} />
    </Frame>
  );
}

/** Two paths side by side — primary against resale, or any either/or. */
function Compare({ id }: { id: string }) {
  return (
    <Frame id={id}>
      <rect x="40" y="42" width="146" height="140" rx="18" fill={SURFACE} stroke={BLUE} strokeWidth="2.5" />
      <rect x="214" y="42" width="146" height="140" rx="18" fill={SURFACE} stroke={LINE} strokeWidth="2" />

      <rect x="64" y="66" width="52" height="52" rx="12" fill={`url(#${id}-g)`} />
      <rect x="76" y="82" width="10" height="10" rx="2" fill="white" opacity="0.85" />
      <rect x="94" y="82" width="10" height="10" rx="2" fill="white" opacity="0.55" />
      <rect x="76" y="100" width="10" height="10" rx="2" fill="white" opacity="0.55" />
      <rect x="94" y="100" width="10" height="10" rx="2" fill="white" opacity="0.85" />

      <rect x="64" y="132" width="84" height="9" rx="4.5" fill={SOFT} />
      <rect x="64" y="150" width="56" height="7" rx="3.5" fill={SOFT} opacity="0.45" />

      <rect x="238" y="66" width="52" height="52" rx="12" fill={MUTED} />
      <path d="M252 104 l12 -14 l10 12 l8 -9 l12 15 z" fill={SOFT} opacity="0.5" />
      <rect x="238" y="132" width="84" height="9" rx="4.5" fill={SOFT} opacity="0.6" />
      <rect x="238" y="150" width="56" height="7" rx="3.5" fill={SOFT} opacity="0.35" />

      <circle cx="200" cy="112" r="20" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <rect x="192" y="109" width="16" height="5" rx="2.5" fill={SOFT} opacity="0.7" />
    </Frame>
  );
}

/** New-build towers. The market itself, at its most recognisable. */
function Skyline({ id }: { id: string }) {
  return (
    <Frame id={id}>
      <circle cx="316" cy="66" r="30" fill={CYAN} opacity="0.35" />

      <rect x="52" y="118" width="58" height="76" rx="8" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <rect x="122" y="74" width="66" height="120" rx="9" fill={SURFACE} stroke={BLUE} strokeWidth="2.5" />
      <rect x="200" y="100" width="52" height="94" rx="8" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <rect x="264" y="52" width="76" height="142" rx="10" fill={`url(#${id}-g)`} />

      {[0, 1, 2, 3].map((row) =>
        [0, 1].map((col) => (
          <rect
            key={`a${row}-${col}`}
            x={64 + col * 22}
            y={132 + row * 15}
            width="14"
            height="9"
            rx="2"
            fill={SOFT}
            opacity="0.25"
          />
        )),
      )}
      {[0, 1, 2, 3, 4, 5].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`b${row}-${col}`}
            x={134 + col * 18}
            y={90 + row * 16}
            width="12"
            height="9"
            rx="2"
            fill={BLUE}
            opacity={(row + col) % 3 === 0 ? 0.55 : 0.18}
          />
        )),
      )}
      {[0, 1, 2, 3, 4, 5, 6].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`c${row}-${col}`}
            x={278 + col * 20}
            y={68 + row * 17}
            width="13"
            height="10"
            rx="2"
            fill="white"
            opacity={(row * 3 + col) % 4 === 0 ? 0.75 : 0.28}
          />
        )),
      )}

      <rect x="28" y="192" width="344" height="4" rx="2" fill={SOFT} opacity="0.25" />
    </Frame>
  );
}

/** A climb: experience bands, seniority, earnings over time. */
function Ladder({ id }: { id: string }) {
  return (
    <Frame id={id}>
      <rect x="52" y="150" width="56" height="44" rx="10" fill={MUTED} />
      <rect x="126" y="118" width="56" height="76" rx="10" fill={BLUE} opacity="0.28" />
      <rect x="200" y="88" width="56" height="106" rx="10" fill={BLUE} opacity="0.55" />
      <rect x="274" y="48" width="56" height="146" rx="10" fill={`url(#${id}-g)`} />

      <path
        d="M64 140 L142 108 L216 78 L296 38"
        fill="none"
        stroke={CYAN}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="1 9"
      />
      <circle cx="296" cy="38" r="9" fill={SURFACE} stroke={CYAN} strokeWidth="3.5" />

      <rect x="28" y="192" width="344" height="4" rx="2" fill={SOFT} opacity="0.25" />
    </Frame>
  );
}

const SCENES = { listing: Listing, compare: Compare, skyline: Skyline, ladder: Ladder };

/**
 * Decorative by design — the headline next to it carries the meaning, so this
 * is hidden from assistive technology rather than given invented alt text.
 */
export function CoverArt({
  slug,
  variant,
  className,
}: {
  slug: string;
  variant?: string | null;
  className?: string;
}) {
  const chosen =
    variant && (COVER_VARIANTS as readonly string[]).includes(variant)
      ? (variant as CoverVariant)
      : pickVariant(slug);

  const Scene = SCENES[chosen];
  // Gradient ids must be unique per rendered instance or the first one on the
  // page wins for every later reference to the same id.
  const id = `bc-cover-${slug.replace(/[^a-z0-9]+/gi, '-')}`;

  return (
    <svg
      viewBox="0 0 400 220"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="presentation"
      aria-hidden
      focusable="false"
    >
      <Scene id={id} />
    </svg>
  );
}
