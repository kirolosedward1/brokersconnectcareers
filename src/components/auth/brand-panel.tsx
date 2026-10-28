import { getLocale, getTranslations } from 'next-intl/server';
import { Building2, Eye, Gift, MessagesSquare, Signpost } from 'lucide-react';
import { Logo } from '@/components/logo';
import { formatNumber } from '@/lib/format';
import { getMarketProof } from '@/lib/queries/market-proof';

type Audience = 'candidate' | 'employer';

/**
 * The brand half of sign-in and sign-up.
 *
 * A flat field of the brand blue, not a gradient, and an elevation of a
 * residential block along the bottom — the thing these jobs are about —
 * so the lower half is a drawing rather than empty sky. A few windows are
 * lit. That is the only motion, and it is off when the reader has asked
 * for less.
 *
 * The line at the foot is a count from the database, and only when that
 * count is real. Nothing here is invented, and a failed read leaves the
 * foot off rather than a sentence.
 */
const POINTS = {
  candidate: [
    { key: 'panelPoint1', icon: Signpost },
    { key: 'panelPoint2', icon: Gift },
    { key: 'panelPoint3', icon: Eye },
  ],
  employer: [
    { key: 'panelEmployer1', icon: Building2 },
    { key: 'panelEmployer2', icon: MessagesSquare },
    { key: 'panelEmployer3', icon: Gift },
  ],
} as const;

export async function BrandPanel({ audience }: { audience?: Audience }) {
  const t = await getTranslations('auth');
  const tMeta = await getTranslations('meta');
  const locale = await getLocale();
  const proof = await getMarketProof();
  const hiring = audience === 'employer';
  const points = hiring ? POINTS.employer : POINTS.candidate;
  const hasProof = proof.jobs != null || proof.companies != null;

  return (
    <aside
      aria-labelledby="auth-panel-title"
      className="auth-brand-panel relative hidden h-dvh flex-col self-start overflow-hidden lg:sticky lg:top-0 lg:flex"
    >
      <div className="auth-panel-rise relative z-10 flex items-center px-12 pt-10 xl:px-16">
        <Logo
          name={tMeta('siteName')}
          tone="onDark"
          markClassName="size-9"
          nameClassName="text-base"
        />
      </div>

      <div className="auth-panel-rise relative z-10 px-12 pt-14 xl:px-16">
        <h2
          id="auth-panel-title"
          className="text-[1.75rem] font-bold leading-tight xl:text-[2rem]"
        >
          {hiring ? t('panelTitleEmployer') : t('panelTitle')}
        </h2>

        <ul className="mt-8 space-y-4">
          {points.map(({ key, icon: Icon }) => (
            <li key={key} className="flex items-center gap-3">
              <Icon className="auth-panel-icon size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="text-base">{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-0 mt-8 min-h-36 flex-1" aria-hidden>
        <Facade />
      </div>

      {hasProof ? (
        <div className="auth-panel-foot auth-panel-rise-late relative z-10 px-12 py-5 xl:px-16">
          <Proof locale={locale} jobs={proof.jobs} companies={proof.companies} />
        </div>
      ) : null}
    </aside>
  );
}

function Proof({
  locale,
  jobs,
  companies,
}: {
  locale: string;
  jobs: number | null;
  companies: number | null;
}) {
  return (
    <p className="text-sm leading-none">
      {jobs != null ? <Count locale={locale} count={jobs} kind="jobs" /> : null}
      {jobs != null && companies != null ? <Join /> : null}
      {companies != null ? <Count locale={locale} count={companies} kind="companies" /> : null}
    </p>
  );
}

async function Join() {
  const t = await getTranslations('auth');
  return <span>{t('panelProofJoin')}</span>;
}

async function Count({
  locale,
  count,
  kind,
}: {
  locale: string;
  count: number;
  kind: 'jobs' | 'companies';
}) {
  const t = await getTranslations('auth');
  const key = kind === 'jobs' ? 'panelJobs' : 'panelCompanies';
  const category = new Intl.PluralRules(locale).select(count);
  const spelled = locale.startsWith('ar') && (category === 'one' || category === 'two');

  return (
    <>
      {spelled ? null : (
        <span className="numeral font-semibold">{formatNumber(count, locale)}</span>
      )}
      {spelled ? null : ' '}
      {t(key, { count })}
    </>
  );
}

/**
 * A residential elevation, not a plotting grid.
 *
 * Three masses — a walk-up, a tower with a crown, a slab — sitting on one
 * plinth. Windows are placed per floor, and a few are lit. Coordinates are
 * the drawing; nothing here is data.
 */
function Facade() {
  return (
    <svg
      viewBox="0 0 640 340"
      preserveAspectRatio="xMidYMax slice"
      className="h-full w-full"
    >
      <rect x="0" y="148" width="78" height="164" fill="var(--auth-panel-mass-deep)" />
      <Bay x={16} y={172} w={14} h={18} />
      <Bay x={40} y={172} w={14} h={18} />
      <Bay x={16} y={214} w={14} h={22} lit delay="1.4s" />
      <Bay x={44} y={248} w={16} h={28} />

      <rect x="52" y="96" width="156" height="216" fill="var(--auth-panel-mass)" />
      <rect x="40" y="196" width="176" height="9" fill="var(--auth-panel-cornice)" />
      <Bay x={70} y={118} w={18} h={26} />
      <Bay x={108} y={122} w={16} h={22} lit delay="0s" />
      <Bay x={146} y={118} w={22} h={26} />
      <Bay x={74} y={160} w={28} h={18} />
      <Bay x={128} y={158} w={36} h={18} lit delay="3.2s" />
      <Bay x={68} y={220} w={14} h={22} />
      <Bay x={92} y={220} w={14} h={22} lit delay="5.1s" />
      <Bay x={128} y={216} w={18} h={26} />
      <Bay x={158} y={220} w={14} h={22} />
      <Bay x={72} y={262} w={20} h={28} lit delay="2.2s" />
      <Bay x={108} y={270} w={24} h={42} />
      <Bay x={148} y={262} w={20} h={28} />

      <rect x="214" y="48" width="148" height="264" fill="var(--auth-panel-mass)" />
      <rect x="228" y="22" width="120" height="28" fill="var(--auth-panel-cornice)" />
      <Bay x={236} y={64} w={16} h={20} />
      <Bay x={268} y={64} w={16} h={20} lit delay="0.6s" />
      <Bay x={312} y={68} w={22} h={16} />
      <Bay x={236} y={100} w={16} h={20} lit delay="4.4s" />
      <Bay x={268} y={100} w={16} h={20} lit delay="1.1s" />
      <Bay x={320} y={104} w={14} h={18} />
      <Bay x={236} y={140} w={16} h={24} />
      <Bay x={268} y={136} w={16} h={28} lit delay="2.8s" />
      <Bay x={308} y={144} w={28} h={16} />
      <Bay x={240} y={184} w={14} h={20} lit delay="6.2s" />
      <Bay x={268} y={180} w={16} h={24} lit delay="0.4s" />
      <Bay x={316} y={184} w={16} h={20} />
      <Bay x={236} y={224} w={18} h={22} />
      <Bay x={268} y={220} w={16} h={26} lit delay="3.8s" />
      <Bay x={308} y={228} w={24} h={16} lit delay="1.8s" />
      <Bay x={240} y={264} w={16} h={22} />
      <Bay x={272} y={260} w={18} h={28} lit delay="5.6s" />
      <Bay x={314} y={268} w={16} h={18} />

      <rect x="372" y="156" width="268" height="156" fill="var(--auth-panel-mass-deep)" />
      <rect x="388" y="144" width="220" height="10" fill="var(--auth-panel-cornice)" />
      <Bay x={396} y={176} w={72} h={12} />
      <Bay x={480} y={176} w={52} h={12} lit delay="2.5s" />
      <Bay x={546} y={176} w={70} h={12} />
      <Bay x={400} y={206} w={96} h={12} lit delay="4.8s" />
      <Bay x={512} y={206} w={64} h={12} />
      <Bay x={408} y={240} w={36} h={22} />
      <Bay x={456} y={236} w={28} h={32} lit delay="0.9s" />
      <Bay x={500} y={246} w={22} h={40} />
      <Bay x={536} y={240} w={48} h={18} lit delay="3.5s" />
      <Bay x={598} y={232} w={18} h={48} />

      <rect x="0" y="312" width="640" height="28" fill="var(--auth-panel-plinth)" />
    </svg>
  );
}

function Bay({
  x,
  y,
  w,
  h,
  lit = false,
  delay = '0s',
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  lit?: boolean;
  delay?: string;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx="1.25"
      fill={lit ? undefined : 'var(--auth-panel-window)'}
      className={lit ? 'auth-panel-light' : undefined}
      style={lit ? { animationDelay: delay } : undefined}
    />
  );
}
