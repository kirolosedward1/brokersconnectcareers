import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TimelineStep = {
  key: string;
  title: string;
  body: string;
  /** The one-line payoff — what the reader gets out of this step. */
  takeaway: string;
  illustration: React.ReactNode;
};

/**
 * The candidate flow as a numbered timeline.
 *
 * A server component with no state: these are three things that happen in
 * order, not three views of one thing, so there is nothing to select. The
 * employer side uses tabs because its steps each produce a different screen
 * worth looking at on its own; here the point is the sequence, and a sequence
 * you have to click through is a sequence you cannot take in at a glance.
 *
 * The spine is drawn with borders rather than an absolutely positioned rule,
 * so it stretches with whatever the content turns out to be and cannot fall
 * out of alignment on a long translation.
 */
export function TimelineSteps({
  steps,
  className,
}: {
  steps: TimelineStep[];
  className?: string;
}) {
  return (
    <ol className={cn('relative', className)}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;

        return (
          <li key={step.key} className="grid grid-cols-[2rem_1fr] gap-x-4 sm:gap-x-5">
            {/* Node and spine */}
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className="numeral grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-sm font-bold text-background"
              >
                {index + 1}
              </span>
              {last ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
            </div>

            <div className={cn('min-w-0', last ? 'pb-0' : 'pb-8')}>
              {/* No panel. The step sat in a tinted box and its illustration in
                  a bordered, shadowed card inside that — a card in a card, on a
                  page section with a border of its own. The spine and the
                  numeral already group a step; the illustration keeps one
                  hairline because it is a picture of an interface and needs an
                  edge to read as one. */}
              <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-10">
                <div>
                  <h3 className="text-lg font-semibold text-balance">{step.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-muted-foreground">{step.body}</p>

                  <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium">
                    <ArrowLeft className="rtl-flip size-4 text-primary" aria-hidden />
                    {step.takeaway}
                  </p>
                </div>

                <div className="overflow-hidden rounded-xl border border-border bg-card p-3">
                  {step.illustration}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
