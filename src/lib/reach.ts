/** The failure half of ActionResult, so callers can read it exactly as they read that. */
export type Unreached = { ok: false; error: 'network'; fieldErrors?: Record<string, string> };

/**
 * A server action whose request never arrived, as a result rather than a throw.
 *
 * A server action is a fetch, and on a phone a fetch fails all the time: a
 * lift, a tunnel, a handover from Wi-Fi to mobile data. The failure is a
 * rejected promise — and every caller in this app awaits its action inside
 * startTransition, where React 19 sends anything thrown to the nearest error
 * boundary. A boundary replaces what it wraps. So a dropped connection on
 * "save" unmounted the form behind the "something went wrong" panel, and Retry
 * rendered it again, empty: a profile, a job post three steps in, an
 * application with its CV attached, all gone to one dead zone.
 *
 * Every caller already has a branch for a result that is not ok — the inline
 * "we couldn't finish that, try again" — and that is the honest answer to a
 * dropped connection too. The form stays exactly as it was, and pressing the
 * button again is the retry. So the rejection becomes that result and nothing
 * else about the caller changes.
 *
 * Next's own control flow (a redirect or notFound thrown by an action) travels
 * as a rejection with a NEXT_ digest; that is not a failure and is passed on.
 */
export async function reach<T>(call: Promise<T>): Promise<T | Unreached> {
  try {
    return await call;
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_')) throw error;

    console.warn(
      '[action] no answer from the server:',
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: 'network' };
  }
}
