import { AlertTriangle, ArrowLeft, Clock, FileText, Inbox, RotateCcw, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';

/**
 * The one thing worth doing right now.
 *
 * Both dashboards were a grid of equal cards, which is a layout that has no
 * opinion: six tiles, a chart and a list, all the same size, none of them
 * saying which of the six matters this morning. A returning user has to read
 * the whole page and work it out, every time, and the thing that actually
 * needed them — three applicants nobody has opened, a listing expiring on
 * Thursday — carried exactly the same weight as a view counter.
 *
 * So one card, above everything, chosen deterministically. Not a ranking model
 * and not a guess: an ordered list of conditions, each read from data the page
 * has already fetched, and the first one that is true wins. Ties are
 * impossible because the order is total, which means the page behaves the same
 * way twice for the same state — a dashboard that reorders itself between
 * refreshes teaches people to distrust it.
 *
 * Nothing renders when nothing needs doing. An empty state here would be a
 * card whose content is "no content", which is worse than the space it takes.
 */

const TONES = {
  urgent: 'border-destructive/30 bg-destructive/5 text-destructive',
  attention: 'border-warning/40 bg-warning-muted text-warning',
  good: 'border-primary/25 bg-primary/5 text-primary',
} as const;

const ICONS = {
  applicants: Inbox,
  expiring: Clock,
  // The same mark the reopen button on the listing row carries, so the card
  // and the button somebody lands on are visibly the same action.
  ended: RotateCcw,
  draft: FileText,
  verification: AlertTriangle,
  profile: UserRound,
  replies: Inbox,
} as const;

export type NextActionKind = keyof typeof ICONS;

export function NextAction({
  kind,
  tone,
  title,
  body,
  cta,
  href,
}: {
  kind: NextActionKind;
  tone: keyof typeof TONES;
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  const Icon = ICONS[kind];

  return (
    <Link
      href={href}
      className={`group flex items-start gap-4 rounded-2xl border p-5 transition-colors hover:bg-card sm:p-6 ${TONES[tone]}`}
    >
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-card/70">
        <Icon className="size-5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium">
          {cta}
          {/* Points the way the language runs, so it reads as "onward" in
              Arabic rather than "back". */}
          <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5 rtl:rotate-0 ltr:rotate-180" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
