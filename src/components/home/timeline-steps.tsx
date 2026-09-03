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
          <li key={step.key} className="grid grid-cols-[2.5rem_1fr] gap-x-4 sm:grid-cols-[3.5rem_1fr] sm:gap-x-6">
            {/* Node and spine */}
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className="numeral grid size-10 shrink-0 place-items-center rounded-2xl bg-foreground text-sm font-bold text-background sm:size-12 sm:text-base"
              >
                {index + 1}
              </span>
              {last ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
            </div>

            <div className={cn('min-w-0', last ? 'pb-0' : 'pb-8 sm:pb-12')}>
              <div className="grid items-center gap-6 rounded-3xl bg-muted/50 p-6 sm:p-8 lg:grid-cols-2 lg:gap-10">
                <div>
                  <h3 className="text-xl font-semibold text-balance sm:text-2xl">{step.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted-foreground">{step.body}</p>

                  <p className="mt-5 inline-flex items-center gap-2 text-sm font-medium">
                    <ArrowLeft className="rtl-flip size-4 text-primary" aria-hidden />
                    {step.takeaway}
                  </p>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
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
