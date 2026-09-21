import { TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Dashboard figures.
 *
 * Two rules every figure follows.
 *
 * Every tile links somewhere you can act. A number with nowhere to click is a
 * decoration, and a dashboard of those is a screen people stop opening.
 *
 * State reads before the figure does. `tone` puts colour on the tile itself,
 * so a listing expiring in two days is legible as urgent before anybody has
 * read the digit — semantic colour, separate from the brand accent.
 */
export type Tone = 'default' | 'accent' | 'warn' | 'urgent' | 'good';

/**
 * The same figures as a ruled strip: one row, one container.
 *
 * A grid of tiles gives every number its own box, border, shadow and icon
 * chip, and nine of those is a screen of furniture around nine digits. The
 * strip keeps what the tiles got right — every figure links to where it can be
 * acted on, and state is said with tone before the digit is read — and spends
 * one border on all of them. Roughly a third of the height, and the figures
 * share a baseline, so they can be compared instead of visited.
 *
 * Tone colours the figure and adds a dot beside the label, so a warning is not
 * carried by colour alone: the dot is a shape that is absent on a calm cell.
 */
const STRIP_TONES: Record<Tone, { value: string; dot: string | null }> = {
  default: { value: 'text-foreground', dot: null },
  accent: { value: 'text-primary', dot: 'bg-primary' },
  good: { value: 'text-success', dot: 'bg-success' },
  warn: { value: 'text-foreground', dot: 'bg-warning' },
  urgent: { value: 'text-destructive', dot: 'bg-destructive' },
};

export type StatCell = {
  label: string;
  value: string;
  href: string;
  tone?: Tone;
  hint?: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
};

export function StatStrip({ cells, label }: { cells: StatCell[]; label: string }) {
  return (
    <dl
      aria-label={label}
      // Hairlines come from the gap over a border-coloured ground, so they
      // stay correct however the cells wrap — two across on a phone, all in
      // one row from `sm` — without a rule per breakpoint.
      // An odd count would leave the last cell of a two-column phone grid
      // beside a hole showing the rule colour, so the last cell takes the row.
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1"
    >
      {cells.map(({ label: cellLabel, value, href, tone = 'default', hint, delta }) => {
        const t = STRIP_TONES[tone];
        const isFigure = /[0-9]/.test(value);
        const Trend = delta?.direction === 'down' ? TrendingDown : TrendingUp;

        return (
          <Link
            key={cellLabel}
            href={href}
            className="group/cell flex min-h-[4.25rem] flex-col justify-center bg-card px-4 py-2.5 transition-colors hover:bg-muted/60"
          >
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground group-hover/cell:text-foreground">
              {t.dot ? <span aria-hidden className={cn('size-1.5 rounded-full', t.dot)} /> : null}
              {cellLabel}
            </dt>
            <dd className="mt-0.5 flex items-baseline gap-2">
              {/* A status word is a label, not a quantity — same rule as the
                  tile: smaller, and never forced left-to-right. */}
              <span className={cn('font-bold leading-tight', isFigure ? 'text-xl' : 'text-sm', t.value)}>
                {isFigure ? <span className="numeral">{value}</span> : value}
              </span>
              {delta && delta.direction !== 'flat' ? (
                <span
                  className={cn(
                    'numeral inline-flex items-center gap-0.5 text-[11px] font-medium',
                    delta.direction === 'up' ? 'text-success' : 'text-destructive',
                  )}
                >
                  <Trend className="size-3" aria-hidden />
                  {delta.value}
                </span>
              ) : null}
              {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
            </dd>
          </Link>
        );
      })}
    </dl>
  );
}

/**
 * What a dashboard shows before there is anything to show.
 *
 * A new account meets this first, so it says what to do rather than reporting
 * that nothing has happened.
 */
export function EmptyDashboard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      <div className="mt-4">{action}</div>
    </div>
  );
}
