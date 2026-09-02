import Script from 'next/script';

/**
 * Analytics, cookie-free and provider-agnostic.
 *
 * Two deliberate constraints.
 *
 * Cookie-free, because the alternative is a consent banner. Under Egypt's PDPL
 * — and for the European traffic a job board inevitably gets — setting an
 * analytics cookie means asking permission first, and a modal over the hero is
 * a real cost in conversion to measure conversion with. Plausible and Umami
 * both count visits without storing anything on the device, so there is
 * nothing to ask about.
 *
 * Provider-agnostic, because the choice is not made yet and should not need a
 * code change. Set the environment variables and it appears; leave them unset
 * — which is the state everywhere today — and this renders nothing at all,
 * with no script, no request and no placeholder.
 *
 *   NEXT_PUBLIC_ANALYTICS_PROVIDER   plausible | umami
 *   NEXT_PUBLIC_ANALYTICS_SITE       the Plausible domain, or the Umami website id
 *   NEXT_PUBLIC_ANALYTICS_SRC        optional, for a self-hosted instance
 */

const DEFAULT_SRC = {
  plausible: 'https://plausible.io/js/script.tagged-events.js',
  umami: 'https://cloud.umami.is/script.js',
} as const;

export function Analytics() {
  const provider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
  const site = process.env.NEXT_PUBLIC_ANALYTICS_SITE;

  if (provider !== 'plausible' && provider !== 'umami') return null;
  if (!site) return null;

  const src = process.env.NEXT_PUBLIC_ANALYTICS_SRC || DEFAULT_SRC[provider];

  return (
    <Script
      src={src}
      strategy="afterInteractive"
      defer
      {...(provider === 'plausible'
        ? { 'data-domain': site }
        : { 'data-website-id': site })}
    />
  );
}
