import type { JobListItem } from '@/lib/job-list';

/**
 * Comparing saved listings side by side: two or three at once — more would
 * not fit a phone's width in columns anyone could read. The website's
 * /dashboard/saved/compare uses the same rule.
 */
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 3;

/**
 * A card tapped while choosing: taken out if it was in, put at the end if it
 * was not and there is room. `refused` when there was no room, so the screen
 * can say why nothing happened.
 */
export function togglePick(picked: readonly string[], id: string): { picked: string[]; refused: boolean } {
  if (picked.includes(id)) return { picked: picked.filter((item) => item !== id), refused: false };
  if (picked.length >= COMPARE_MAX) return { picked: [...picked], refused: true };
  return { picked: [...picked, id], refused: false };
}

/** The compare screen's `ids` as the listings to show, in the order they were picked: no repeats, at most three. */
export function parseCompareIds(param: string | string[] | undefined): string[] {
  const raw = Array.isArray(param) ? param.join(',') : (param ?? '');
  const ids: string[] = [];
  for (const id of raw.split(',')) {
    const clean = id.trim();
    if (clean && !ids.includes(clean)) ids.push(clean);
  }
  return ids.slice(0, COMPARE_MAX);
}

/** The rows where one listing can be better than another, as the compare screen marks them. */
export type BestRows = { salary: ReadonlySet<string>; commission: ReadonlySet<string>; leads: ReadonlySet<string>; seats: ReadonlySet<string> };

/** Who brings the clients, best first for the consultant: the company does, then both, then the consultant alone. */
const LEADS_RANK: Record<JobListItem['leads_source'], number> = { company_provided: 2, hybrid: 1, self_generated: 0 };

/**
 * The listings with the highest score, or none: when fewer than two have a
 * score to compare, or every one with a score scores the same, no column is
 * better — one with nothing to compare (a commission split, not said) is not
 * beaten by the others' equal figures.
 */
function winners(jobs: readonly JobListItem[], score: (job: JobListItem) => number | null): ReadonlySet<string> {
  const scored = jobs.flatMap((job) => {
    const value = score(job);
    return value === null ? [] : [{ id: job.id, value }];
  });
  if (scored.length < 2) return new Set();
  const top = Math.max(...scored.map((item) => item.value));
  const best = scored.filter((item) => item.value === top);
  return best.length === scored.length ? new Set() : new Set(best.map((item) => item.id));
}

/**
 * Which column is best in each row that has a better: the highest basic salary
 * (its top, or its floor when only that is said; commission-only is none), the
 * highest stated commission percentage, the company bringing the clients, and
 * the most open seats.
 */
export function bestOf(jobs: readonly JobListItem[]): BestRows {
  return {
    salary: winners(jobs, (job) => job.basic_salary_max ?? job.basic_salary_min ?? 0),
    commission: winners(jobs, (job) =>
      job.commission_type === 'percentage' && job.commission_value != null ? job.commission_value : null,
    ),
    leads: winners(jobs, (job) => LEADS_RANK[job.leads_source]),
    seats: winners(jobs, (job) => job.seats),
  };
}
