/**
 * What every server action answers: success with optional data, or a short
 * error code and, for a form, the field each problem belongs to.
 *
 * Its own file because the actions that declare it are `'use server'`
 * modules, and the mobile app — which calls the same actions over
 * /api/mobile/v1 and gets this exact shape back — cannot import one.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
