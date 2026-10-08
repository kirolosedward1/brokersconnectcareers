import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { canBrowseAgentDirectory } from '@/lib/permissions';
import type { AgentDirectoryResponse } from '@/lib/mobile-api/reads';
import { getJson } from '~/lib/api';
import { createLocalList } from '~/lib/local-list';
import { useSession } from '~/lib/session';

/**
 * A consultant search a company keeps: the directory's own address (the
 * website's parameters, `directorySearch`), what to call it, the consultants
 * it had already seen, and how many new ones were last found.
 */
export type SavedAgentSearch = {
  id: string;
  search: string;
  label: string;
  seen: string[];
  fresh: number;
  checkedAt: number;
};

/** Searches kept, and the consultants remembered as seen per search (the first page is what is compared). */
const KEPT = 10;
const SEEN = 200;
/** How often the searches are asked again while the app is in use. */
const EVERY_MS = 30 * 60 * 1000;

export const savedAgentSearches = createLocalList<SavedAgentSearch>('bc.agent-searches.v1', {
  max: KEPT,
  idOf: (search) => search.id,
  valid: (item): item is SavedAgentSearch => {
    const search = item as SavedAgentSearch | null;
    return Boolean(search && typeof search.id === 'string' && typeof search.search === 'string' && Array.isArray(search.seen));
  },
});

async function firstPage(search: string): Promise<AgentDirectoryResponse> {
  return getJson<AgentDirectoryResponse>(`/api/mobile/v1/agents${search ? `?${search}` : ''}`, { signedIn: true });
}

/** Keep a search, with everyone it shows now counted as seen. */
export async function saveAgentSearch(owner: string, search: string, label: string): Promise<void> {
  const page = await firstPage(search);
  savedAgentSearches.add(owner, {
    id: search || 'all',
    search,
    label,
    seen: page.agents.map((agent) => agent.id).slice(0, SEEN),
    fresh: 0,
    checkedAt: Date.now(),
  });
}

/** Looked at: what it shows now is seen. */
export async function markSearchSeen(owner: string, saved: SavedAgentSearch): Promise<void> {
  const page = await firstPage(saved.search);
  savedAgentSearches.add(owner, { ...saved, seen: page.agents.map((agent) => agent.id).slice(0, SEEN), fresh: 0, checkedAt: Date.now() });
}

/**
 * Asks each kept search again and counts the consultants it had not shown
 * before. When a search has more new ones than it last said, the phone says
 * so — a notification of the app's own, on this phone, where the person has
 * let the app notify (it never asks here). Returns how many are new in all.
 */
export async function checkAgentSearches(owner: string, words: (label: string, count: number) => { title: string; body: string }): Promise<number> {
  const searches = await savedAgentSearches.read(owner);
  let total = 0;
  for (const saved of searches) {
    let page: AgentDirectoryResponse;
    try {
      page = await firstPage(saved.search);
    } catch {
      total += saved.fresh;
      continue;
    }
    const seen = new Set(saved.seen);
    const fresh = page.agents.filter((agent) => !seen.has(agent.id)).length;
    total += fresh;
    if (fresh > saved.fresh) await tell(words(saved.label, fresh - saved.fresh), saved.search);
    if (fresh !== saved.fresh) savedAgentSearches.add(owner, { ...saved, fresh, checkedAt: Date.now() });
  }
  return total;
}

async function tell({ title, body }: { title: string; body: string }, search: string) {
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { localHref: `/agents${search ? `?${search}` : ''}` } },
      trigger: null,
    });
  } catch {
    // A notification that cannot be shown leaves the count on the directory, which says it anyway.
  }
}

/**
 * For a company that reads the directory: its kept searches asked again when
 * the app opens and each time it comes back, at most every half hour.
 */
export function useConsultantAlerts(words: (label: string, count: number) => { title: string; body: string }) {
  const { actor, session } = useSession();
  const owner = session?.user.id ?? null;
  const allowed = canBrowseAgentDirectory(actor);
  useEffect(() => {
    if (!owner || !allowed) return;
    let last = 0;
    const run = () => {
      if (Date.now() - last < EVERY_MS) return;
      last = Date.now();
      checkAgentSearches(owner, words).catch(() => {});
    };
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
    // The words are the same catalogue's each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, allowed]);
}
