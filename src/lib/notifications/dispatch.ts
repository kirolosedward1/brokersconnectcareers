/**
 * The channel runner behind publish(), kept free of server imports so
 * scripts/notification-dispatch.test.mjs can exercise its failure rules under
 * plain Node.
 *
 * The rules: in-app first, then each email handler in order; every channel is
 * caught on its own, so one failing — the provider down, a bell write refused
 * — neither stops the next nor undoes what an earlier one did. Never throws.
 */

export type ChannelOutcome = 'sent' | 'skipped' | 'failed';

export type InAppRoute<E> =
  | `trigger:${string}`
  | `sweep:${string}`
  | 'none'
  | ((event: E) => Promise<void>);

export type Route<E> = {
  inApp: InAppRoute<E>;
  email: ((event: E) => Promise<ChannelOutcome>)[];
};

export type DispatchReport = {
  inApp: 'database' | 'written' | 'failed' | 'none';
  email: ChannelOutcome[];
};

export async function dispatch<E extends { type: string }>(
  route: Route<E>,
  event: E,
  warn: (message: string) => void = (message) => console.warn(message),
): Promise<DispatchReport> {
  const report: DispatchReport = { inApp: 'none', email: [] };

  if (typeof route.inApp === 'function') {
    try {
      await route.inApp(event);
      report.inApp = 'written';
    } catch (error) {
      report.inApp = 'failed';
      warn(`[notify] in-app for ${event.type} failed: ${describe(error)}`);
    }
  } else if (route.inApp !== 'none') {
    report.inApp = 'database';
  }

  for (const send of route.email) {
    try {
      report.email.push(await send(event));
    } catch (error) {
      report.email.push('failed');
      warn(`[notify] email for ${event.type} failed: ${describe(error)}`);
    }
  }

  return report;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
