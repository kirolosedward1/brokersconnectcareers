import { Check, X } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { timelineSteps, type TimelineStep } from '@/lib/application-stages';
import { formatDayMonth } from '@/lib/format';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { cn } from '@/lib/utils';

/**
 * Where an application stands, as the app draws it
 * (mobile/src/components/applications/timeline.tsx): four steps in a row in
 * the reading's direction — sent, seen by the company, shortlisted or called
 * to interview, the decision — each a mark on a line with its name under it.
 * Reached steps are filled green (a rejection red, where the line ends); the
 * one it waits at is ringed in the brand colour and breathes. The rule is
 * shared (timelineSteps, src/lib/application-stages.ts), and so are the words.
 */
export async function ApplicationSteps({
  application,
  locale,
}: {
  application: { status: ApplicationStatus; created_at: string; employer_viewed_at: string | null };
  locale: string;
}) {
  const t = await getTranslations('myApplications');
  const tStatus = await getTranslations('applicationStatus');
  const steps = timelineSteps(application);

  const name = (step: TimelineStep) => {
    switch (step.key) {
      case 'sent':
        return t('stepSent');
      case 'seen':
        return t('stepSeen');
      case 'shortlisted':
        return application.status === 'interview' ? tStatus('interview') : tStatus('shortlisted');
      case 'decision':
        return application.status === 'hired' || application.status === 'rejected' ? tStatus(application.status) : t('stepDecision');
    }
  };

  const reached = (step: TimelineStep) => step.state === 'done' || step.state === 'stopped';
  /** The colour a line takes towards a step: the step's own once it is reached or waited at. */
  const lineTo = (step: TimelineStep) =>
    step.state === 'ahead' ? 'bg-border' : step.state === 'stopped' ? 'bg-destructive' : step.state === 'current' ? 'bg-primary' : 'bg-success';

  return (
    <ol className="mt-3 flex" aria-label={t('timeline')}>
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-1 flex-col items-center gap-1 text-center" aria-current={step.state === 'current' ? 'step' : undefined}>
          <div className="flex w-full items-center" aria-hidden>
            <span className={cn('h-0.5 flex-1', index === 0 ? 'bg-transparent' : lineTo(step))} />
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:fill-mode-both',
                step.state === 'done' && 'bg-success text-white',
                step.state === 'stopped' && 'bg-destructive text-white',
                step.state === 'current' && 'border-2 border-primary bg-card motion-safe:animate-pulse',
                step.state === 'ahead' && 'border-2 border-border bg-card',
              )}
              style={{ animationDelay: `${index * 140}ms` }}
            >
              {step.state === 'done' ? <Check className="size-3" strokeWidth={3} /> : null}
              {step.state === 'stopped' ? <X className="size-3" strokeWidth={3} /> : null}
            </span>
            <span className={cn('h-0.5 flex-1', index === steps.length - 1 ? 'bg-transparent' : lineTo(steps[index + 1]))} />
          </div>
          <span
            className={cn(
              'text-xs',
              step.state === 'current' ? 'font-semibold' : 'font-medium',
              reached(step) || step.state === 'current' ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {name(step)}
          </span>
          {step.date && reached(step) ? (
            <span className="text-xs text-muted-foreground">{formatDayMonth(step.date, locale)}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
