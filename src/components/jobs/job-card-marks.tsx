'use client';

import { BookmarkCheck, CheckCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SaveJobToggle } from '@/components/jobs/save-job-toggle';
import { useJobMarks } from '@/components/jobs/job-marks';

/**
 * Applied and saved state on a card that is otherwise cached HTML.
 *
 * The board and the home page prerender without a reader, so this cannot be
 * read in the server card: the hook lives in a client module, and calling it
 * there fails the build the moment a card is actually rendered. The marks
 * arrive after hydration, from JobMarks, and only when a session cookie is
 * already in the browser. Until then both pieces render nothing, which is
 * also what a signed-out reader and a crawler should see.
 *
 * Callers that already know the state — the saved list, the dashboard —
 * pass it in. The fetched marks are OR-ed on top, so a cached board can
 * still light up for the person reading it.
 */

export function JobCardMarkBadge({
  jobId,
  applied = false,
  saved = false,
  savable = false,
  labels,
}: {
  jobId: string;
  applied?: boolean;
  saved?: boolean;
  savable?: boolean;
  labels: { applied: string; saved: string };
}) {
  const marks = useJobMarks();
  const showApplied = applied || marks.applied.has(jobId);
  const showSaved = saved || marks.saved.has(jobId);
  const canSave = savable || marks.savable;

  // Applied wins when both are true: having applied is the stronger fact,
  // and two badges on one card is the noise this is meant to save.
  if (showApplied) {
    return (
      <Badge variant="success">
        <CheckCheck aria-hidden />
        {labels.applied}
      </Badge>
    );
  }

  // Only where there is no toggle. When the bookmark is on the card, it
  // already shows the state, and a badge saying the same word beside it is
  // the card repeating itself.
  if (showSaved && !canSave) {
    return (
      <Badge variant="outline">
        <BookmarkCheck aria-hidden />
        {labels.saved}
      </Badge>
    );
  }

  return null;
}

export function JobCardSave({
  jobId,
  saved = false,
  savable = false,
  labels,
}: {
  jobId: string;
  saved?: boolean;
  savable?: boolean;
  labels: { save: string; remove: string };
}) {
  const marks = useJobMarks();
  const showSaved = saved || marks.saved.has(jobId);
  const canSave = savable || marks.savable;

  // Mounts only once saving is possible, so initialSaved is the fetched
  // answer rather than the empty state the toggle would otherwise keep.
  if (!canSave) return null;

  return <SaveJobToggle jobId={jobId} initialSaved={showSaved} labels={labels} />;
}
