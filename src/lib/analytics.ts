/**
 * Recording the two ratios that are the business.
 *
 *   view -> apply     does a listing convert a reader into an applicant
 *   post -> publish   does an employer who starts a listing finish it
 *
 * Page views are counted by the script itself. This is only for the moments
 * that page views cannot see, and it stays deliberately small: an event with
 * no question attached to it is a number nobody will ever look at.
 *
 * A no-op when analytics is not configured, which is every environment today —
 * so callers never need to check first.
 */

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Props }) => void;
    umami?: { track?: (event: string, props?: Props) => void };
  }
}

export type AnalyticsEvent =
  /** A candidate submitted an application. */
  | 'apply_completed'
  /** An employer sent a listing for review. */
  | 'job_submitted'
  /** A signed-out reader hit the sign-in wall on the apply form. */
  | 'apply_blocked_signed_out';

export function track(event: AnalyticsEvent, props?: Props): void {
  if (typeof window === 'undefined') return;

  try {
    window.plausible?.(event, props ? { props } : undefined);
    window.umami?.track?.(event, props);
  } catch {
    // Measurement must never be able to break the thing being measured.
  }
}
