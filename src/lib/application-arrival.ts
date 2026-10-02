/**
 * Which telling of a stage this is — the number the email's key carries, and
 * the bell's (migration 345, on_application_moved), so the two agree on what
 * "once" means.
 *
 * A candidate is told each stage their application reaches, except `new`:
 * that is where an application starts, never a decision. What they have been
 * told is the history without `new`, with a stage that follows itself told
 * once. So shortlisted → new → shortlisted is one "shortlisted" (an employer
 * tidying their board), and rejected → shortlisted → rejected is two
 * "rejected"s: the second is news, because their last word from us said
 * "shortlisted". Keyed on the stage alone, it was never sent.
 *
 * `history` is the application's stages in the order they were recorded, the
 * arrival being told included. The first telling is 1.
 */
export function stageTelling(history: readonly string[], status: string): number {
  let tellings = 0;
  let last: string | null = null;
  for (const stage of history) {
    if (stage === 'new') continue;
    if (stage === status && last !== status) tellings += 1;
    last = stage;
  }
  return Math.max(1, tellings);
}

/**
 * What a telling adds to its key: nothing the first time, so a message keyed
 * before this rule is never sent again under a new name; `:2`, `:3`… after.
 */
export function tellingSuffix(telling: number): string {
  return telling > 1 ? `:${telling}` : '';
}
