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
    /*
      Across from `lg`, down below it.

      This was a vertical spine on every screen: numeral, text, and the picture
      pushed to the far edge of a row as wide as the page, with a column of
      nothing between the sentence and the drawing it belonged to. Three steps
      took a thousand pixels to say three sentences. Side by side each step is
      one glance — drawing, numeral, sentence — and the sequence reads in the
      direction the language does, which a numbered row gets for free in RTL.

      The pictures share one fixed height and sit on a common baseline, so
      square and landscape drawings line up and the three headings start level.
    */
    <ol className={cn('grid gap-x-10 gap-y-8 lg:grid-cols-3', className)}>
      {steps.map((step, index) => (
        <li key={step.key} className="flex gap-4 lg:flex-col lg:gap-0">
          <div className="flex h-24 w-24 shrink-0 items-end justify-center sm:h-32 sm:w-32 lg:h-44 lg:w-full lg:justify-start">
            <div className="flex h-full w-full items-end [&_img]:max-h-full [&_img]:w-auto [&_img]:max-w-full [&_img]:object-contain">
              {step.illustration}
            </div>
          </div>

          <div className="min-w-0 lg:mt-4 lg:border-t lg:border-border lg:pt-4">
            <h3 className="flex items-center gap-2.5 text-base font-semibold text-balance">
              <span
                aria-hidden
                className="numeral grid size-6 shrink-0 place-items-center rounded-md bg-foreground text-xs font-bold text-background"
              >
                {index + 1}
              </span>
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>

            <p className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium">
              <ArrowLeft className="rtl-flip size-3.5 text-primary" aria-hidden />
              {step.takeaway}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
