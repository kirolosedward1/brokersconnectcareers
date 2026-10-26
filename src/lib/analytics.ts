/**
 * Recording the two ratios that are the business.
 *
 *   view -> apply     does a listing convert a reader into an applicant
 *   post -> publish   does an employer who starts a listing finish it
 *   share -> apply    does a forwarded listing bring anybody who applies
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
  | 'apply_blocked_signed_out'
  /**
   * A reader arrived on a listing from a forwarded link.
   *
   * Its own event because a WhatsApp forward carries no referrer: without
   * this every one of them is direct traffic, indistinguishable from somebody
   * typing the address. Paired with the `src` property on apply_completed, it
   * answers the question worth asking — not how far a share travelled, but
   * whether it brought anybody who applied.
   */
  | 'arrived_from_share'
  /**
   * A visitor entered the board from the home page's browse module — by
   * district, by track, or by the kind of company. Three events rather than
   * one with a `dimension` property, so each is a goal on its own in a
   * dashboard that cannot filter a goal by property. `value` is the taxonomy
   * slug that was chosen.
   */
  | 'homepage_job_browse_location'
  | 'homepage_job_browse_category'
  | 'homepage_job_browse_company_type'
  /**
   * The page for the app, /app. One question — does the page send anybody
   * to the store — and two that say which part of it earned the click:
   * `location` on the store click is hero, sticky or final; the other two
   * carry the tab or the question that was opened.
   */
  | 'app_store_click'
  | 'app_tour_tab'
  | 'app_faq_open';

export function track(event: AnalyticsEvent, props?: Props): void {
  if (typeof window === 'undefined') return;

  try {
    window.plausible?.(event, props ? { props } : undefined);
    window.umami?.track?.(event, props);
  } catch {
    // Measurement must never be able to break the thing being measured.
  }
}
