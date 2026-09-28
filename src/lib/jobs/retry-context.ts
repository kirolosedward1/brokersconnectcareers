import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RetryContext } from './outbox-sweep';

/**
 * How deliver() learns it is running as a retry, without every notify
 * function growing a parameter it would only ever pass along.
 *
 * The rebuilders call the same notify functions the product does, which call
 * deliver() three frames down. Threading a lease token through all of them
 * would put a sweeper concern into twenty signatures that have nothing to do
 * with retrying. An AsyncLocalStorage carries it across those awaits instead:
 * set by the sweeper around one rebuild, read by deliver(), gone when the
 * rebuild returns — so an ordinary send can never see a lease that is not
 * its own.
 */

const storage = new AsyncLocalStorage<RetryContext>();

export function runInRetryContext<T>(ctx: RetryContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The retry this call is part of, or undefined for an ordinary send. */
export function currentRetryContext(): RetryContext | undefined {
  return storage.getStore();
}
