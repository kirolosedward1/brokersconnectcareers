import { cn } from '@/lib/utils';

/**
 * A row of chips that never strands one on its own line.
 *
 * Wrapping is what does it. Four chips and a label at 375px wrap three-and-one,
 * and because the row is centred that last chip lands alone in the middle of an
 * empty line — which reads as a mistake rather than as a row. Six chips wrap
 * four-and-two, which is only less obviously wrong.
 *
 * So on a phone this does not wrap at all: one line, scrolled. The count stops
 * mattering, the shape is the same whether there are three chips or nine, and a
 * partly visible chip at the edge is the standard signal that the row
 * continues. From `sm` up there is room to wrap honestly, so it does.
 *
 * The same trade the applicants stage filter makes, for the same reason —
 * that one wrapped to five rows and ate half a phone screen before a single
 * applicant appeared.
 *
 * Chips must not shrink inside the scrolling row, so `shrink-0` belongs on the
 * children rather than here; `Chip` below does it.
 */
export function ChipRow({
  children,
  center = false,
  className,
}: {
  children: React.ReactNode;
  /** Centre the wrapped rows on wider screens. Ignored while scrolling. */
  center?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-2 overflow-x-auto pb-1',
        // The scrollbar is chrome on a row this short, and on a hero it sits
        // over the artwork.
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        'sm:flex-wrap sm:overflow-x-visible sm:pb-0',
        center && 'sm:justify-center',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One chip.
 *
 * `tone` exists because these sit on two very different grounds — the hero's
 * artwork and an ordinary page — and a single border colour cannot serve both.
 */
export function Chip({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'onDark';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors',
        tone === 'onDark'
          ? 'border border-white/20 bg-white/5 text-white/90 hover:border-white/40 hover:bg-white/15'
          : 'border border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
