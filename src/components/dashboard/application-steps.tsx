import { getTranslations } from 'next-intl/server';
import { formatDayMonth } from '@/lib/format';
import type { ApplicationProgress, ProgressSegment, ProgressStepKey, ProgressSummary, SegmentTone } from '@/lib/application-stages';
import { cn } from '@/lib/utils';

function summaryLine(
  t: (key: 'lineSent' | 'lineSeen' | 'lineShortlisted' | 'lineHired' | 'lineRejected' | 'lineWithdrawn') => string,
  summary: ProgressSummary,
): string {
  switch (summary) {
    case 'sent':
      return t('lineSent');
    case 'seen':
      return t('lineSeen');
    case 'shortlisted':
      return t('lineShortlisted');
    case 'hired':
      return t('lineHired');
    case 'rejected':
      return t('lineRejected');
    case 'withdrawn':
      return t('lineWithdrawn');
  }
}

const TONE_CLASS: Record<SegmentTone, string> = {
  done: 'bg-primary',
  current: 'bg-card ring-1 ring-inset ring-primary',
  upcoming: 'bg-foreground/15',
  rejected: 'bg-destructive',
  withdrawn: 'bg-foreground/25',
};

/**
 * The candidate's progress, as one short bar.
 *
 * Four segments when the outcome is still open or it ended in a hire: 4px
 * tall, 4px apart, the width of the card. Brand blue once a step has
 * happened, white with a blue ring on the step it is waiting at, grey for
 * what has not happened. A rejection drops the steps that never happened and
 * paints only the last segment red. A withdrawal draws the steps it had
 * reached, in grey. Nothing under the bar but one line: the latest fact and,
 * when a real timestamp exists, its date.
 *
 * The same progress object drives the pill on the card. The list below is
 * for a screen reader; the bar itself is drawn, not announced.
 */
export async function ApplicationSteps({
  progress,
  locale,
}: {
  progress: ApplicationProgress;
  locale: string;
}) {
  const t = await getTranslations('myApplications');

  const stepName = (key: ProgressStepKey, tone: SegmentTone) => {
    if (tone === 'rejected') return t('lineRejected');
    switch (key) {
      case 'sent':
        return t('stepSent');
      case 'seen':
        return t('stepSeen');
      case 'shortlisted':
        return t('stepShortlist');
      case 'decision':
        return progress.summary === 'hired' ? t('pillHired') : t('stepDecision');
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

  const dated = (date: string | null) => (date ? formatDayMonth(date, locale) : '');

  const spoken = (segment: ProgressSegment) => {
    const name = stepName(segment.key, segment.tone);
    const when = segment.tone === 'done' || segment.tone === 'withdrawn' || segment.tone === 'rejected' ? dated(segment.date) : '';
    const parts = segment.tone === 'rejected' ? [name] : [name, stateName(segment.tone)];
    if (when) parts.push(when);
    return parts.join(' · ');
  };

  const sentence = summaryLine(t, progress.summary);
  const summaryDate = dated(progress.summaryDate);
  const line = summaryDate ? `${sentence} · ${summaryDate}` : sentence;

  return (
    <div>
      <ol className="sr-only" aria-label={t('timeline')}>
        {progress.segments.map((segment) => (
          <li key={segment.key} aria-current={segment.tone === 'current' ? 'step' : undefined}>
            {spoken(segment)}
          </li>
        ))}
      </ol>
      <div className="flex w-full gap-1" aria-hidden>
        {progress.segments.map((segment) => (
          <span key={segment.key} className={cn('h-1 min-w-0 flex-1 rounded-full', TONE_CLASS[segment.tone])} />
        ))}
      </div>
      <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">{line}</p>
    </div>
  );
}
