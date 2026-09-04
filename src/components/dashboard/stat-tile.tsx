import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * A dashboard tile.
 *
 * Two rules the whole grid follows.
 *
 * Every tile links somewhere you can act. A number with nowhere to click is a
 * decoration, and a dashboard of those is a screen people stop opening.
 *
 * State reads before the figure does. `tone` puts colour on the tile itself,
 * so a listing expiring in two days is legible as urgent before anybody has
 * read the digit — semantic colour, separate from the brand accent.
 */
export type Tone = 'default' | 'accent' | 'warn' | 'urgent' | 'good';

const TONES: Record<Tone, { tile: string; icon: string; value: string }> = {
  default: {
    tile: 'border-border bg-card hover:border-primary/30',
    icon: 'bg-muted text-muted-foreground',
    value: 'text-foreground',
  },
  accent: {
    tile: 'border-primary/25 bg-primary/[0.04] hover:border-primary/45',
    icon: 'bg-brand-gradient text-primary-foreground shadow-[var(--shadow-primary)]',
    value: 'text-foreground',
  },
  good: {
    tile: 'border-success/25 bg-success/[0.05] hover:border-success/45',
    icon: 'bg-success/15 text-success',
    value: 'text-success',
  },
  warn: {
    tile: 'border-warning/30 bg-warning/[0.06] hover:border-warning/50',
    icon: 'bg-warning/15 text-warning',
    value: 'text-foreground',
  },
  urgent: {
    tile: 'border-destructive/30 bg-destructive/[0.05] hover:border-destructive/50',
    icon: 'bg-destructive/12 text-destructive',
    value: 'text-destructive',
  },
};

export function StatTile({
  label,
  value,
  href,
  icon: Icon,
  tone = 'default',
  hint,
  delta,
}: {
  label: string;
  value: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  hint?: string;
  /** Change against the previous period. Omitted when there is nothing to compare. */
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
}) {
  const t = TONES[tone];
  const Trend = delta?.direction === 'down' ? TrendingDown : TrendingUp;

  return (
    <Link
      href={href}
      className={cn(
        'lift group/tile relative flex flex-col rounded-xl border p-4 shadow-sm transition-colors',
        t.tile,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span aria-hidden className={cn('grid size-8 place-items-center rounded-lg', t.icon)}>
          <Icon className="size-4" />
        </span>

        {delta && delta.direction !== 'flat' ? (
          <span
            className={cn(
              'numeral inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
              delta.direction === 'up'
                ? 'bg-success/12 text-success'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            <Trend className="size-3" aria-hidden />
            {delta.value}
          </span>
        ) : null}
      </div>

      <p className={cn('numeral mt-3 text-2xl font-bold leading-none', t.value)}>{value}</p>
      <p className="mt-1.5 text-[13px] font-medium leading-snug">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}

      {/* The affordance without the height. This used to be a row of its own
          at the foot of every tile, which cost a line of space on all nine of
          them to say something the hover state already says. */}
      <ArrowLeft
        aria-hidden
        className="rtl-flip absolute bottom-3 end-3 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/tile:opacity-100"
      />
    </Link>
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
    <div className="rounded-2xl border border-dashed border-border p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}
