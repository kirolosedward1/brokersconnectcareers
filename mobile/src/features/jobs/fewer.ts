import { useMemo } from 'react';
import type { JobListItem } from '@/lib/job-list';
import type { JobTrack } from '@/lib/supabase/database.types';
import { JOB_TRACKS } from '@/lib/taxonomy';
import { createLocalList } from '~/lib/local-list';

/**
 * "Show fewer like this": the kinds of listing — a track in a district, as
 * «بيع أول · التجمع الخامس» — this person asked to see less of, from a card's
 * menu. Home's suggested roles put listings of those kinds after every other
 * (candidate.ts); nothing is hidden, and the board is left as it is: it is
 * the reader's own search, and what it shows is what they asked for.
 *
 * Kept on this phone, per person (src/lib/local-list.ts), newest first, with
 * the district's name as it was, so Account → "Hidden on this phone" can list
 * them without asking anyone. Nothing about it reaches the website.
 */
export type FewerKind = {
  track: JobTrack;
  districtId: number;
  district: { name_ar: string; name_en: string | null };
};

/** More than anyone sets aside, and a bound on what one key holds. */
const KEPT = 50;

function isFewerKind(item: unknown): item is FewerKind {
  const kind = item as FewerKind | null;
  return Boolean(
    kind &&
      (JOB_TRACKS as readonly string[]).includes(kind.track) &&
      typeof kind.districtId === 'number' &&
      kind.district &&
      typeof kind.district.name_ar === 'string',
  );
}

/** One kind's key: its track and district. */
export function fewerKey(kind: { track: JobTrack; districtId?: number; district_id?: number }): string {
  return `${kind.track}:${kind.districtId ?? kind.district_id}`;
}

const kinds = createLocalList<FewerKind>('bc.fewer-like-this.v1', { max: KEPT, idOf: fewerKey, valid: isFewerKind });

/** A listing's kind, with its district's name as the card has it. */
export function kindOf(job: Pick<JobListItem, 'track' | 'district_id' | 'district'>): FewerKind {
  return { track: job.track, districtId: job.district_id, district: { name_ar: job.district.name_ar, name_en: job.district.name_en } };
}

export function showFewer(owner: string, job: Pick<JobListItem, 'track' | 'district_id' | 'district'>) {
  kinds.add(owner, kindOf(job));
}

export function showAsUsual(owner: string, key: string) {
  kinds.remove(owner, key);
}

/** The kinds this person sees fewer of, newest first. */
export function useFewerKinds(owner: string): readonly FewerKind[] {
  return kinds.useItems(owner);
}

/** The same, as keys to look a listing up in. */
export function useFewerKeys(owner: string): ReadonlySet<string> {
  const items = kinds.useItems(owner);
  return useMemo(() => new Set(items.map(fewerKey)), [items]);
}

/**
 * A ranking with the listings of those kinds moved after every other, each
 * part in its own order: still there, never first.
 */
export function fewerLast<T extends { job: Pick<JobListItem, 'track' | 'district_id'> }>(ranked: readonly T[], keys: ReadonlySet<string>): T[] {
  if (!keys.size) return [...ranked];
  const muted = (item: T) => keys.has(fewerKey(item.job));
  return [...ranked.filter((item) => !muted(item)), ...ranked.filter(muted)];
}

/** For tests: forget what each person set aside. */
export function resetFewerForTests() {
  kinds.resetForTests();
}
