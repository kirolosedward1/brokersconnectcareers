import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from 'expo-router';
import { hashKey, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { JobListItem } from '@/lib/job-list';
import type { JobBoardResponse } from '@/lib/mobile-api/reads';
import { useAppliedJobIds } from '~/features/jobs/marks';
import { useListOwner } from '~/features/jobs/recent';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useHiddenJobs, withoutHiddenJobs } from '~/features/moderation/hidden-jobs';
import { createLocalList } from '~/lib/local-list';

/**
 * "New since your last visit": where on the board the listings this person
 * has not been shown yet end, and how many of them the Jobs tab's badge counts.
 *
 * What is remembered is the newest listing's published_at the board showed
 * them, not the time they opened it. The time they opened it would be the
 * phone's clock against the server's, which need not agree; and the board a
 * person opens is often the copy kept from last time (query.ts), read again
 * behind it — a listing published while they were away but not yet on the
 * screen they were looking at would have counted as seen. The newest one they
 * were shown is a fact about what was in front of them, on the server's
 * clock: everything published after it is honestly new to them.
 *
 * Only the whole board moves it — no filters, newest first, as the Jobs tab
 * opens — because only there is everything older than its newest listing on
 * the screen as well. A board narrowed to one track says nothing about the
 * listings in the others, so it marks nothing as seen (and the badge, counted
 * on the whole board, stays until the whole board has been opened).
 *
 * Kept on this phone, per person (src/lib/local-list.ts), as one entry.
 */
type Seen = { at: string };

const seen = createLocalList<Seen>('bc.board-seen.v1', {
  max: 1,
  // One entry: each newer one takes its place.
  idOf: () => 'board',
  valid: (item): item is Seen => typeof (item as Seen | null)?.at === 'string' && !Number.isNaN(instant((item as Seen).at)),
});

/**
 * A timestamp as milliseconds, NaN when it names none. Postgres's text form
 * can end in an hours-only offset ("…+00"), which Hermes does not read; it is
 * completed first, as src/lib/format.ts does before it formats one.
 */
export function instant(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return new Date(value.replace(/(:\d{2}(?:\.\d+)?)([+-]\d{2})$/, '$1$2:00')).getTime();
}

/** The newest published_at among these listings, as written. */
export function newestPublished(jobs: readonly Pick<JobListItem, 'published_at'>[]): string | null {
  let newest: string | null = null;
  for (const job of jobs) {
    if (!Number.isNaN(instant(job.published_at)) && (newest === null || instant(job.published_at) > instant(newest))) newest = job.published_at;
  }
  return newest;
}

/** How many of these listings were published after `since`. Nothing before the board was first opened. */
export function countNewSince(jobs: readonly Pick<JobListItem, 'published_at'>[], since: string | null): number {
  const mark = instant(since);
  if (Number.isNaN(mark)) return 0;
  return jobs.filter((job) => instant(job.published_at) > mark).length;
}

/**
 * The listing the divider goes above, on a board newest first: the first one
 * published before `since` with something newer above it. Sponsored listings
 * are pinned above every order, so an old one at the top is not where the
 * old ones start; the ones already applied to are at the foot under their
 * own heading, out of the order. None when nothing is new, or nothing old has
 * been read yet (the divider waits for the page that has one).
 */
export function seenDividerBefore(
  jobs: readonly Pick<JobListItem, 'id' | 'published_at' | 'is_featured'>[],
  since: string | null | undefined,
  applied: ReadonlySet<string>,
): string | null {
  const mark = instant(since);
  if (Number.isNaN(mark)) return null;
  let newAbove = false;
  for (const job of jobs) {
    if (applied.has(job.id)) continue;
    if (instant(job.published_at) > mark) {
      newAbove = true;
      continue;
    }
    if (job.is_featured) continue;
    return newAbove ? job.id : null;
  }
  return null;
}

/**
 * When this person last looked, as the board had it when this visit began —
 * undefined until the board has listings (`ready`) and the phone has said
 * when. A visit ends when the reader leaves the Jobs tab for another, or the
 * app for the background, and the next one's starting point is read then,
 * while the board is out of view and cannot move it: coming back, the
 * divider is already where it belongs, and what is seen from then on is
 * written over a starting point already taken. Opening a listing and coming
 * back, or changing the filters and taking them off again, is one visit: the
 * divider stays where it was.
 */
export function useBoardVisit(owner: string, ready: boolean): string | null | undefined {
  const navigation = useNavigation();
  const [visit, setVisit] = useState(0);
  const [since, setSince] = useState<{ owner: string; visit: number; at: string | null } | null>(null);
  const known = since !== null && since.owner === owner && since.visit === visit;

  useEffect(() => {
    let tab: typeof navigation | undefined = navigation;
    while (tab && tab.getState()?.type !== 'tab') tab = tab.getParent();
    const ended = () => setVisit((count) => count + 1);
    const leftTab = tab?.addListener('blur', ended);
    // To the background — not a glance at Notification Centre, which is active → inactive → active.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') ended();
    });
    return () => {
      leftTab?.();
      subscription.remove();
    };
  }, [navigation]);

  // Asked once a visit, once there is a board to draw the line on: nothing needs it before.
  useEffect(() => {
    if (!ready || known) return;
    let live = true;
    void seen.read(owner).then((items) => {
      if (live) setSince({ owner, visit, at: items[0]?.at ?? null });
    });
    return () => {
      live = false;
    };
  }, [owner, visit, ready, known]);

  return known ? since.at : undefined;
}

/**
 * While the whole board is in view (see the top of this file), the newest
 * listing on it is remembered as seen — once this visit's `since` has been
 * read, so the divider is drawn from the last visit, not this one. Never
 * moved back: a listing taken down does not make older ones new again.
 */
export function useMarkBoardSeen(
  owner: string,
  { since, whole, inView, jobs }: { since: string | null | undefined; whole: boolean; inView: boolean; jobs: readonly JobListItem[] },
) {
  // What this board has written: the phone answers a read after a write, not before it.
  const written = useRef<{ owner: string; at: number }>({ owner, at: Number.NEGATIVE_INFINITY });
  useEffect(() => {
    if (since === undefined || !whole || !inView) return;
    const newest = newestPublished(jobs);
    if (!newest) return;
    const floor = Math.max(written.current.owner === owner ? written.current.at : Number.NEGATIVE_INFINITY, since ? instant(since) : Number.NEGATIVE_INFINITY);
    if (!(instant(newest) > floor)) return;
    written.current = { owner, at: instant(newest) };
    seen.add(owner, { at: newest });
  }, [owner, since, whole, inView, jobs]);
}

const WHOLE_BOARD = ['jobs', 'board', ''];
const WHOLE_BOARD_HASH = hashKey(WHOLE_BOARD);

/**
 * The Jobs tab's badge: how many listings on the first page of the whole
 * board were published after the newest one this person was shown — without
 * what this phone hides and what they applied to. Counted from the board
 * already read (Home reads it, and so does the board), followed in the cache
 * rather than asked for: no read of its own, ever. Nothing before the board
 * has first been opened, and nothing once it has been opened again.
 */
export function useNewJobsBadge(): number {
  const client = useQueryClient();
  const owner = useListOwner();
  const since = seen.useItems(owner)[0]?.at ?? null;
  const subscribe = useCallback(
    (onChange: () => void) =>
      client.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === WHOLE_BOARD_HASH) onChange();
      }),
    [client],
  );
  const first = useSyncExternalStore(subscribe, () => client.getQueryData<InfiniteData<JobBoardResponse>>(WHOLE_BOARD)?.pages[0]);
  const hiddenCompanies = useHiddenCompanies();
  const hiddenJobs = useHiddenJobs();
  const listed = useMemo(
    () => (first ? withoutHiddenJobs(withoutHidden(first.jobs, hiddenCompanies), hiddenJobs) : []),
    [first, hiddenCompanies, hiddenJobs],
  );
  const ids = useMemo(() => listed.map((job) => job.id), [listed]);
  const applied = useAppliedJobIds(ids);
  return useMemo(() => countNewSince(listed.filter((job) => !applied.has(job.id)), since), [listed, applied, since]);
}

/** For tests: forget what each person was shown. */
export function resetBoardSeenForTests() {
  seen.resetForTests();
}
