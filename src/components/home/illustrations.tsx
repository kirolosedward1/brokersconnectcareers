import { BLUE, Bloom, Card, Defs, LINE, MUTED, OK, SOFT, SURFACE, svgProps } from './illustration-kit';

/**
 * Section illustrations, drawn rather than sourced.
 *
 * Drawn so they inherit the theme instead of shipping a PNG per mode, and so
 * they cost nothing to load.
 *
 * The previous version of this one was grey bars: a card with placeholder
 * lines, a second card with more placeholder lines, and an eye-off badge. It
 * was the generic SaaS drawing that could sit on any product's page, and it
 * said nothing the paragraph beside it did not already say.
 *
 * This one draws the actual rule. The section promises that a visitor sees a
 * consultant's track, district and years but never their name or their number,
 * so the card shows exactly that — real chips a reader can read, and the
 * identity blurred out where the product blurs it. The three settings sit
 * beside it with the middle one chosen, because that is the choice being
 * described.
 *
 * Purely decorative: aria-hidden, and the prose beside it carries the meaning
 * for anybody who cannot see it.
 */

const COPY = {
  ar: {
    track: 'بيع أول',
    district: 'التجمع الخامس',
    years: '7 سنين خبرة',
    everyone: 'ظاهر للجميع',
    verified: 'للموثّقين بس',
    hidden: 'مخفي',
  },
  en: {
    track: 'Primary',
    district: 'Fifth Settlement',
    years: '7 yrs experience',
    everyone: 'Everyone',
    verified: 'Verified only',
    hidden: 'Hidden',
  },
} as const;

/** A consultant's profile, and the switch that decides who can see them. */
export function VisibilityIllustration({
  className,
  locale = 'ar',
}: {
  className?: string;
  locale?: 'ar' | 'en';
}) {
  const id = 'bc-ill-vis';
  const t = COPY[locale] ?? COPY.ar;
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <svg viewBox="0 0 460 320" className={className} {...svgProps}>
      <Defs id={id} />

      {/*
        A floor plan, at the faintest weight the eye still registers.

        This is the one piece of real-estate geometry in the drawing, and it is
        background rather than subject — the brief for this product is a
        recruitment platform that happens to serve property, not a brochure.
      */}
      <g stroke={LINE} strokeWidth={1} opacity={0.5}>
        <path d="M18 250 h132 v52" fill="none" />
        <path d="M150 276 h60" fill="none" />
        <path d="M78 250 v52" fill="none" />
        <path d="M330 34 h112 v58 h-112 z" fill="none" />
        <path d="M386 34 v58" fill="none" />
        <path d="M330 63 h112" fill="none" />
      </g>

      <Bloom id={id} cx={120} cy={90} r={150} />
      <Bloom id={id} cx={372} cy={244} r={120} second />

      {/* ---- the consultant, as a visitor sees them ---------------------- */}
      <Card id={id} x={26} y={62} w={250} h={196} raised />

      {/*
        Identity, withheld. The avatar is a silhouette and the name is a bar,
        because that is precisely what the section says a visitor gets — and
        drawing a name here would contradict the sentence beside it.
      */}
      <circle cx={64} cy={102} r={20} fill={MUTED} />
      <circle cx={64} cy={96} r={7} fill={SOFT} opacity={0.35} />
      <path d="M52 114 a12 9 0 0 1 24 0 z" fill={SOFT} opacity={0.35} />
      <rect x={96} y={92} width={96} height={9} rx={4.5} fill={SOFT} opacity={0.28} />
      <rect x={96} y={108} width={58} height={7} rx={3.5} fill={SOFT} opacity={0.18} />

      {/* Small lock, so "withheld" reads as deliberate rather than unfinished. */}
      <g transform="translate(232 92)">
        <rect x={0} y={5} width={14} height={11} rx={3} fill={SOFT} opacity={0.45} />
        <path d="M3 5 v-3 a4 4 0 0 1 8 0 v3" fill="none" stroke={SOFT} strokeWidth={1.8} opacity={0.45} />
      </g>

      {/* ---- what a visitor does get, spelled out ------------------------ */}
      <g fontSize={12} fontWeight={600} direction={dir}>
        <rect x={50} y={140} width={92} height={28} rx={9} fill={BLUE} opacity={0.1} />
        <text x={96} y={158} textAnchor="middle" fill={BLUE}>
          {t.track}
        </text>

        <rect x={150} y={140} width={110} height={28} rx={9} fill={MUTED} />
        <text x={205} y={158} textAnchor="middle" fill={SOFT}>
          {t.district}
        </text>
      </g>

      <g fontSize={12} direction={dir}>
        <circle cx={58} cy={192} r={4} fill={OK} />
        <text x={72} y={196} fill={SOFT}>
          {t.years}
        </text>
      </g>

      <path d="M50 216 h200" stroke={LINE} strokeWidth={1} />

      <g fontSize={11} direction={dir}>
        <text x={50} y={238} fill={SOFT} opacity={0.75}>
          {locale === 'ar' ? 'التواصل بعد الموافقة' : 'Contact after approval'}
        </text>
      </g>

      {/* ---- the three settings, middle one chosen ----------------------- */}
      <Card id={id} x={300} y={110} w={136} h={150} raised />

      <g fontSize={11} direction={dir}>
        <rect x={314} y={126} width={108} height={34} rx={10} fill={MUTED} />
        <circle cx={332} cy={143} r={6} fill={SOFT} opacity={0.3} />
        <text x={348} y={147} fill={SOFT}>
          {t.everyone}
        </text>

        <rect x={314} y={168} width={108} height={34} rx={10} fill={`url(#${id}-brand)`} />
        <circle cx={332} cy={185} r={6} fill="white" opacity={0.95} />
        <text x={348} y={189} fill="white" fontWeight={600}>
          {t.verified}
        </text>

        <rect x={314} y={210} width={108} height={34} rx={10} fill={MUTED} />
        <circle cx={332} cy={227} r={6} fill={SOFT} opacity={0.3} />
        <text x={348} y={231} fill={SOFT}>
          {t.hidden}
        </text>
      </g>

      {/*
        The connection the whole product is about: this consultant, reaching
        that company, only because the middle setting is the one switched on.
      */}
      <path
        d="M276 160 C 292 160, 292 185, 300 185"
        fill="none"
        stroke={BLUE}
        strokeWidth={1.8}
        strokeDasharray="4 4"
        opacity={0.55}
      />

      {/* The eye, sitting on the join. */}
      <circle cx={288} cy={78} r={22} fill={SURFACE} stroke={LINE} strokeWidth={1.5} />
      <circle cx={288} cy={78} r={22} fill={BLUE} opacity={0.08} />
      <path
        d="M278 78 a10 7 0 0 1 20 0 a10 7 0 0 1 -20 0"
        fill="none"
        stroke={BLUE}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <circle cx={288} cy={78} r={3} fill={BLUE} />
    </svg>
  );
}
