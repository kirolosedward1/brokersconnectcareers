import { followedCompany } from '@/lib/saved-search';

/**
 * The day's notification about new listings, from what each of a person's
 * saved searches found (/api/cron/new-jobs, migration 334).
 *
 * One notification, however many searches found something: a person who
 * follows three companies and saves two searches hears once a day, not five
 * times. It names what found the jobs when only one thing did — the followed
 * company, or the search by its label — and otherwise says how many, and its
 * link goes where they are: the company's page, the board with that search's
 * filters (newest first, the board's default), or the saved searches page.
 * A listing found by two searches counts once.
 *
 * Pure, so scripts/new-jobs.test.mjs runs it under plain Node.
 */

/** How far back a search's first look goes. */
export const FIRST_LOOK_HOURS = 24;

/**
 * A search looked at more recently than this is not due. Less than a day, so
 * tomorrow's run finds everything today's covered; long enough that a second
 * run today (a retry, a manual call) does not look again.
 */
export const DUE_AFTER_HOURS = 20;

export type NewJob = {
  id: string;
  company: { slug: string; name_ar: string; name_en: string | null } | null;
};

/** One saved search and the listings it found that were published since it was last looked at. */
export type SearchFinding = { label: string; query: string; jobs: NewJob[] };

export type NewJobsPayload = {
  count: number;
  /** What found them: one followed company, one search, or several. */
  source: 'follow' | 'search' | 'mixed';
  /** source 'search': the search's own name. */
  label?: string;
  /** source 'follow': the company. */
  slug?: string;
  name_ar?: string;
  name_en?: string | null;
};

export type NewJobsNotice = { payload: NewJobsPayload; href: string };

export function newJobsNotice(findings: readonly SearchFinding[]): NewJobsNotice | null {
  const found = findings.filter((finding) => finding.jobs.length > 0);
  const count = new Set(found.flatMap((finding) => finding.jobs.map((job) => job.id))).size;
  if (count === 0) return null;

  if (found.length === 1) {
    const [only] = found;
    const slug = followedCompany(only.query);
    if (slug) {
      // A follow's listings are all that company's; the name comes with them.
      const company = only.jobs.find((job) => job.company?.slug === slug)?.company ?? null;
      return {
        payload: {
          count,
          source: 'follow',
          slug,
          ...(company ? { name_ar: company.name_ar, name_en: company.name_en } : {}),
        },
        href: `/companies/${encodeURIComponent(slug)}`,
      };
    }
    return {
      payload: { count, source: 'search', label: only.label },
      href: only.query ? `/jobs?${only.query}` : '/jobs',
    };
  }

  return { payload: { count, source: 'mixed' }, href: '/dashboard/saved' };
}

/** Whether a listing was published after a moment, comparing instants rather than strings. */
export function publishedAfter(publishedAt: string | null | undefined, since: string): boolean {
  if (!publishedAt) return false;
  const at = Date.parse(publishedAt);
  const from = Date.parse(since);
  return Number.isFinite(at) && Number.isFinite(from) && at > from;
}

export type LookOutcome = 'notified' | 'nothing_new' | 'already_today' | 'not_candidates';

/**
 * What one person's turn needs from the database and the board — handed in,
 * so the rules below are tested without either (the route wires the real
 * ones). Each throws on a failure it cannot retry through.
 */
export type LookContext = {
  /** The run's start: where each search's cursor moves. */
  cursor: string;
  /** How far back a search's first look goes. */
  firstLook: string;
  /** The person's searches that have alerts on. */
  searches(person: string): Promise<{ id: string; label: string; query: string; bell_checked_at: string | null }[]>;
  role(person: string): Promise<string | null>;
  /** The board's first page for a saved query, newest first, as anybody may see it. */
  board(query: string): Promise<(NewJob & { published_at: string | null })[]>;
  /** Which of these listings the person has applied to. */
  applied(person: string, jobIds: string[]): Promise<string[]>;
  /** Writes the day's notification: its id, or null when today's already exists. */
  record(person: string, notice: NewJobsNotice): Promise<string | null>;
  /** Moves the searches' cursor; does not throw (a failure is logged). */
  advance(searchIds: string[], cursor: string): Promise<void>;
  /** Called once per search run against the board. */
  onSearch?(): void;
};

/**
 * One person's turn: what their searches found since each was last looked at,
 * less what they already applied to, told once.
 *
 * The cursors move to the run's start once the day's notification is written,
 * when there was nothing new, and for somebody no longer a candidate (their
 * rows go to the back of the line, untold). They stay when today's
 * notification already existed — a second run today: what it found is
 * tomorrow's news — and when anything throws, so the next run tries again.
 */
export async function lookForNewJobs(person: string, ctx: LookContext): Promise<LookOutcome> {
  const searches = await ctx.searches(person);
  if (!searches.length) return 'nothing_new';

  let outcome: LookOutcome;
  if ((await ctx.role(person)) !== 'candidate') {
    outcome = 'not_candidates';
  } else {
    const findings: SearchFinding[] = [];
    for (const search of searches) {
      ctx.onSearch?.();
      const since = search.bell_checked_at ?? ctx.firstLook;
      const jobs = await ctx.board(search.query);
      findings.push({
        label: search.label,
        query: search.query,
        jobs: jobs
          .filter((job) => publishedAfter(job.published_at, since))
          .map((job) => ({ id: job.id, company: job.company })),
      });
    }

    const found = [...new Set(findings.flatMap((finding) => finding.jobs.map((job) => job.id)))];
    if (found.length) {
      const done = new Set(await ctx.applied(person, found));
      for (const finding of findings) finding.jobs = finding.jobs.filter((job) => !done.has(job.id));
    }

    const notice = newJobsNotice(findings);
    outcome = !notice ? 'nothing_new' : (await ctx.record(person, notice)) ? 'notified' : 'already_today';
  }

  if (outcome !== 'already_today') {
    await ctx.advance(
      searches.map((search) => search.id),
      ctx.cursor,
    );
  }
  return outcome;
}
