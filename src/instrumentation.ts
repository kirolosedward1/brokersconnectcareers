import type { Instrumentation } from 'next';
import { describeCrash } from '@/lib/crash';
import { logFailure } from '@/lib/observe';

/**
 * Every render, route, server action or middleware that throws on the server,
 * as one privacy-safe line (src/lib/crash.ts): the route's pattern, the kind
 * of error and its code, and the digest the error page shows the reader, so a
 * code read out to support finds its route. Next.js still prints the error
 * itself, as it always has; this adds the line that can be searched and kept.
 *
 * Never throws: a crash report that crashes the request is worse than none.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  try {
    logFailure('crash', 'a request threw', describeCrash(error, request.method, context));
  } catch {
    // Nothing more to do with a crash we could not even describe.
  }
};
