import type { AbstractIntlMessages } from "next-intl";

/**
 * Which messages reach the browser.
 *
 * next-intl hands the whole catalogue to NextIntlClientProvider unless it is
 * told otherwise, and the provider serialises what it is given into the HTML.
 * So every visitor to /jobs was downloading the moderation queue's copy, the
 * email activity screen's column headers, the job wizard, the CV editor and
 * the account settings — 50 KB of JSON, 14 KB of the 67 KB a compressed job
 * board page weighs, on a market that is almost entirely mobile and metered.
 *
 * Only *client* components need any of it. Server components read through
 * getTranslations, which never leaves the server: 54 of 220 files are client
 * components, and between them they read 31 of the 42 namespaces. Eleven are
 * never needed in a browser at all.
 *
 * Two lists rather than one, because the console's copy is no use to somebody
 * reading job adverts. The public site gets the first; the console nests a
 * second provider and gets both.
 *
 * Both lists are checked against the source by `pnpm test:messages`, which
 * reads the namespaces every client component actually asks for. A stale list
 * is a MISSING_MESSAGE at runtime, which is exactly the kind of thing that
 * only shows up on the one screen nobody opened before deploying.
 */

/** Namespaces the public site's client components read. Dotted paths allowed. */
export const PUBLIC_MESSAGES = [
  "agents",
  "apply",
  "auth",
  "availability",
  "common",
  "companies",
  "employmentType",
  "experienceBand",
  "filters",
  "jobs",
  // Only the tab labels, not the 8 KB of landing-page prose around them —
  // that half is server-rendered.
  "landingPage.tabs",
  "leadsSource",
  "onboarding",
  "reportReason",
  "savedSearch",
  "theme",
  "track",
  "validation",
] as const;

/** What the console's client components need on top of the above. */
export const CONSOLE_MESSAGES = [
  "account",
  "admin",
  "applicationStatus",
  "benefits",
  "commissionType",
  "compensation",
  "cv",
  "dashboard",
  "employer",
  "jobForm",
  "language",
  "nav",
  "visibility",
] as const;

/**
 * A subset of the catalogue, by namespace or dotted path.
 *
 * Paths are shallow-merged, so 'landingPage.tabs' and 'landingPage.hero' can
 * both be asked for and arrive as one `landingPage` object.
 */
export function pick(
  messages: AbstractIntlMessages,
  paths: readonly string[],
): AbstractIntlMessages {
  const out: Record<string, unknown> = {};

  for (const path of paths) {
    const segments = path.split(".");
    let source: unknown = messages;
    for (const segment of segments) {
      if (source == null || typeof source !== "object") {
        source = undefined;
        break;
      }
      source = (source as Record<string, unknown>)[segment];
    }
    // A path naming nothing is a bug in the list, not a reason to ship an
    // `undefined` that becomes a MISSING_MESSAGE three screens away. The test
    // that derives these lists from source is what catches it.
    if (source === undefined) continue;

    let target = out;
    for (const segment of segments.slice(0, -1)) {
      const existing = target[segment];
      target[segment] =
        existing && typeof existing === "object"
          ? existing
          : ({} as Record<string, unknown>);
      target = target[segment] as Record<string, unknown>;
    }
    target[segments[segments.length - 1]] = source;
  }

  return out as AbstractIntlMessages;
}
