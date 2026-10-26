import type { ApplicationProgress, ProgressStepKey, SegmentTone } from '@/lib/application-stages';

/**
 * How the candidate stepper draws one progress result.
 *
 * The statuses, which steps exist, and which one is current all come from
 * {@link applicationProgress}. This only chooses the mark and the words: a
 * finished step is a check, the step being waited on is a filled dot with a
 * halo, a rejection is an X on the last step, and a withdrawal is a plain
 * grey dot. The line into a step is brand blue once that step has been
 * reached — including a rejection — and grey otherwise. It is never a red bar.
 */

export type StepperLabel = 'sent' | 'seen' | 'shortlist' | 'decision' | 'rejected';

export type StepperMark = 'check' | 'halo' | 'dot' | 'x';

/** Blue once the next step is reached or current. Grey while it is still ahead, or the whole line was withdrawn. */
export type StepperConnector = 'progress' | 'muted';

export type StepperItem = {
  key: ProgressStepKey;
  label: StepperLabel;
  state: SegmentTone;
  current: boolean;
  mark: StepperMark;
  /** From this dot to the next. Null on the last step. */
  connector: StepperConnector | null;
};

const LABEL: Record<ProgressStepKey, Exclude<StepperLabel, 'rejected'>> = {
  sent: 'sent',
  seen: 'seen',
  shortlisted: 'shortlist',
  decision: 'decision',
};

function mark(tone: SegmentTone): StepperMark {
  switch (tone) {
    case 'done':
      return 'check';
    case 'current':
      return 'halo';
    case 'rejected':
      return 'x';
    case 'upcoming':
    case 'withdrawn':
      return 'dot';
  }
}

function connector(next: SegmentTone | undefined): StepperConnector | null {
  if (next === undefined) return null;
  if (next === 'upcoming' || next === 'withdrawn') return 'muted';
  return 'progress';
}

export function applicationStepper(progress: ApplicationProgress): StepperItem[] {
  return progress.segments.map((segment, index) => ({
    key: segment.key,
    label: segment.tone === 'rejected' ? 'rejected' : LABEL[segment.key],
    state: segment.tone,
    current: segment.tone === 'current',
    mark: mark(segment.tone),
    connector: connector(progress.segments[index + 1]?.tone),
  }));
}
