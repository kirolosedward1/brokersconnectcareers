import { getTranslations } from 'next-intl/server';
import { Check, X } from 'lucide-react';
import {
  applicationStepper,
  type StepperItem,
  type StepperLabel,
} from '@/lib/application-stepper';
import type { ApplicationProgress, SegmentTone } from '@/lib/application-stages';
import { cn } from '@/lib/utils';

/**
 * The candidate's progress, as a short labelled stepper.
 *
 * Four dots when the outcome is still open or it ended in a hire, fewer when
 * a rejection skipped a step that never happened or a withdrawal stopped
 * early. Each dot is 10px. A finished step is filled brand blue with a check,
 * the step being waited on is a filled blue dot with a soft halo, and what
 * has not happened yet is light grey. A rejection keeps the steps that did
 * happen blue and ends on a red cross. A withdrawal draws only the steps it
 * reached, in grey. The line between two dots is 2px, blue up to the step
 * now in progress and grey after it — a rejection does not paint that line red.
 *
 * The row is at most 420px and follows the writing direction, so in Arabic
 * the first step is the rightmost. The same progress object drives the pill
 * on the card. The names are the visible labels; whether a step has been
 * reached is said again for a screen reader.
 */
export async function ApplicationSteps({ progress }: { progress: ApplicationProgress }) {
  const t = await getTranslations('myApplications');
  const items = applicationStepper(progress);

  const stepName = (label: StepperLabel) => {
    switch (label) {
      case 'sent':
        return t('stepSent');
      case 'seen':
        return t('stepSeen');
      case 'shortlist':
        return t('stepShortlist');
      case 'decision':
        return t('stepDecision');
      case 'rejected':
        return t('lineRejected');
    }
  };

  const stateName = (tone: SegmentTone) => {
    switch (tone) {
      case 'done':
        return t('stateDone');
      case 'current':
        return t('stateCurrent');
      case 'upcoming':
        return t('stateUpcoming');
      case 'rejected':
        return t('stateRejected');
      case 'withdrawn':
        return t('stateWithdrawn');
    }
  };

  return (
    <ol
      aria-label={t('timeline')}
      className={cn(
        'm-0 flex max-w-[420px] list-none p-0',
        // One step has nothing to share the row with. Stretching it would
        // park the dot in the middle of the card.
        items.length === 1 ? 'w-max' : 'w-full',
      )}
    >
      {items.map((item) => (
        <li
          key={item.key}
          aria-current={item.current ? 'step' : undefined}
          className={cn(
            'relative flex min-w-0 flex-col items-center',
            // A quarter of the 420px row. Fewer steps stay grouped at the
            // start instead of stretching apart.
            items.length > 1 && 'max-w-[105px] flex-1',
          )}
        >
          {item.connector ? (
            <span
              aria-hidden
              className={cn(
                'absolute top-[4px] z-0 h-0.5 w-full start-1/2',
                item.connector === 'progress' ? 'bg-primary' : 'bg-foreground/20',
              )}
            />
          ) : null}
          <StepDot item={item} />
          <span
            title={stepName(item.label)}
            className={cn(
              'mt-1 truncate px-0.5 text-center text-[11px] leading-4',
              items.length > 1 ? 'w-full' : 'whitespace-nowrap',
              item.current
                ? 'font-bold text-foreground'
                : item.state === 'rejected'
                  ? 'font-medium text-destructive'
                  : 'text-muted-foreground',
            )}
          >
            {stepName(item.label)}
          </span>
          <span className="sr-only">{stateName(item.state)}</span>
        </li>
      ))}
    </ol>
  );
}

/** One 10px mark. The halo sits behind the current dot and does not take layout space. */
function StepDot({ item }: { item: StepperItem }) {
  const filled =
    item.mark === 'check' || item.mark === 'halo'
      ? 'bg-primary text-primary-foreground'
      : item.mark === 'x'
        ? 'bg-destructive text-destructive-foreground'
        : item.state === 'withdrawn'
          ? 'bg-foreground/25'
          : 'bg-foreground/15';

  return (
    <span aria-hidden className="relative z-10 grid size-2.5 shrink-0 place-items-center">
      {item.mark === 'halo' ? <span className="absolute -inset-[3px] rounded-full bg-primary/30" /> : null}
      <span className={cn('relative grid size-2.5 place-items-center rounded-full', filled)}>
        {item.mark === 'check' ? <Check className="size-[7px]" strokeWidth={3} /> : null}
        {item.mark === 'x' ? <X className="size-[7px]" strokeWidth={3} /> : null}
      </span>
    </span>
  );
}
