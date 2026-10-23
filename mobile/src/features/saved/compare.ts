/**
 * The compare rule lives with the website (`src/lib/saved/compare.ts`): the
 * saved page and `/dashboard/saved/compare` use the same two-or-three limit
 * and the same "best" marks as this screen.
 */
export {
  COMPARE_MAX,
  COMPARE_MIN,
  bestOf,
  parseCompareIds,
  togglePick,
  type BestRows,
} from '@/lib/saved/compare';
