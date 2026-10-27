/**
 * Where a first visit came from.
 *
 * One classifier, used by the website and by the app. It reads what the
 * browser already has — the referrer, the campaign on the address, whether a
 * Google or Meta click id was present — and names a source. It does not keep
 * the click id, the path's query, or an address. The first answer is the one
 * that is stored; callers must not ask again with a later visit.
 */

import { safeNext } from '@/lib/safe-next';

export const FIRST_SOURCES = [
  'direct',
  'google',
  'google_ads',
  'facebook',
  'instagram',
  'tiktok',
  'linkedin',
  'whatsapp',
  'x',
  'email',
  'referral',
  'other',
  'app',
] as const;

export type FirstSource = (typeof FIRST_SOURCES)[number];

/** What the first page saw. Click ids are flags, never the id itself. */
export type RawTouch = {
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  gclid?: boolean;
  fbclid?: boolean;
  landingPath?: string | null;
  /** The Expo app, or the site opened inside it. */
  inApp?: boolean;
  /** When this device first saw the visit. Not a later page. */
  seenAt?: string | null;
};

export type ClassifiedTouch = {
  source: FirstSource;
  medium: string | null;
  campaign: string | null;
  /** The referring host, or null when there was none or it was our own site. */
  referrer: string | null;
  landingPath: string | null;
};

const SOURCE_WORDS: Record<string, FirstSource> = {
  google: 'google',
  facebook: 'facebook',
  fb: 'facebook',
  meta: 'facebook',
  instagram: 'instagram',
  ig: 'instagram',
  insta: 'instagram',
  tiktok: 'tiktok',
  tt: 'tiktok',
  linkedin: 'linkedin',
  li: 'linkedin',
  whatsapp: 'whatsapp',
  wa: 'whatsapp',
  twitter: 'x',
  x: 'x',
  email: 'email',
  newsletter: 'email',
  mail: 'email',
  referral: 'referral',
  direct: 'direct',
  app: 'app',
};

const PAID = /^(cpc|ppc|paid|paid_social|display|cpm|cpv)$/i;

/** Mail clients before the search engines that own some of them. */
const HOST_RULES: { test: (host: string) => boolean; source: FirstSource }[] = [
  { test: (host) => host === 'mail.google.com' || host.endsWith('.mail.google.com'), source: 'email' },
  { test: (host) => /(^|\.)outlook\.live\.com$/.test(host) || host === 'outlook.office.com' || host === 'mail.yahoo.com', source: 'email' },
  { test: (host) => host === 'l.instagram.com' || host === 'instagram.com' || host.endsWith('.instagram.com'), source: 'instagram' },
  { test: (host) => /(^|\.)facebook\.com$/.test(host) || host === 'fb.com' || host.endsWith('.fb.com') || host === 'lm.facebook.com' || host === 'm.facebook.com' || host === 'l.facebook.com', source: 'facebook' },
  { test: (host) => /(^|\.)tiktok\.com$/.test(host), source: 'tiktok' },
  { test: (host) => /(^|\.)linkedin\.com$/.test(host) || host === 'lnkd.in', source: 'linkedin' },
  { test: (host) => /(^|\.)whatsapp\.com$/.test(host) || host === 'wa.me' || host === 'api.whatsapp.com', source: 'whatsapp' },
  { test: (host) => host === 't.co' || /(^|\.)twitter\.com$/.test(host) || host === 'x.com' || host.endsWith('.x.com'), source: 'x' },
  { test: (host) => /(^|\.)googleadservices\.com$/.test(host) || /(^|\.)googlesyndication\.com$/.test(host), source: 'google_ads' },
  { test: (host) => host === 'google.com' || host.startsWith('www.google.') || host.startsWith('google.') || /(^|\.)google\.[a-z.]+$/.test(host), source: 'google' },
];

function clip(value: string | null | undefined, max: number): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.slice(0, max);
}

/** A host, lowercase, without a port or a leading www — or null when it is not a URL. */
export function hostOf(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

function ownSite(host: string, ownHosts: string[]): boolean {
  return ownHosts.some((own) => {
    const needle = hostOf(own);
    return needle !== null && (host === needle || host.endsWith(`.${needle}`));
  });
}

function wordSource(value: string | null): FirstSource | null {
  if (!value) return null;
  const word = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '');
  return SOURCE_WORDS[word] ?? null;
}

function hostSource(host: string | null): FirstSource | null {
  if (!host) return null;
  return HOST_RULES.find((rule) => rule.test(host))?.source ?? null;
}

/**
 * The path only, and only when it is a path on our site.
 *
 * `safeNext` is the one definition of an internal path. A full address is
 * reduced to its pathname first. A protocol-relative value, a backslash, or
 * an encoded `//` is not a path.
 */
export function landingPathOf(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const direct = safeNext(text);
  const path =
    direct ??
    (() => {
      try {
        return safeNext(new URL(text).pathname);
      } catch {
        return null;
      }
    })();
  if (!path) return null;
  const clean = path.split('?')[0]?.split('#')[0] ?? '';
  return clean.slice(0, 200) || null;
}

/**
 * Name the first visit.
 *
 * `ownHosts` are this site. A referrer that is us is not a source — the person
 * was already here. `inApp` is the app, and it wins: the app has no page
 * referrer worth trusting.
 */
export function classifyTouch(raw: RawTouch, ownHosts: string[] = []): ClassifiedTouch {
  const campaign = clip(raw.utmCampaign, 120);
  const mediumIn = clip(raw.utmMedium, 80);
  const landingPath = landingPathOf(raw.landingPath);
  const host = hostOf(raw.referrer);
  const referrer = host && !ownSite(host, ownHosts) ? host : null;

  if (raw.inApp) {
    return { source: 'app', medium: mediumIn ?? 'app', campaign, referrer: null, landingPath };
  }

  const named = wordSource(raw.utmSource ?? null);
  const paid = Boolean(raw.gclid) || (mediumIn !== null && PAID.test(mediumIn));
  let source: FirstSource;

  if (raw.gclid || (named === 'google' && paid)) source = 'google_ads';
  else if (named === 'instagram') source = 'instagram';
  else if (named && named !== 'direct') source = named === 'google' ? 'google' : named;
  else if (raw.fbclid) source = 'facebook';
  else {
    const fromHost = hostSource(referrer);
    if (fromHost === 'google' && paid) source = 'google_ads';
    else if (fromHost) source = fromHost;
    else if (referrer) source = 'referral';
    else source = 'direct';
  }

  const medium =
    mediumIn ??
    (source === 'google_ads' ? 'cpc'
    : source === 'email' ? 'email'
    : source === 'referral' ? 'referral'
    : source === 'direct' ? null
    : 'social');

  return { source, medium, campaign, referrer: source === 'direct' ? null : referrer, landingPath };
}

export function isFirstSource(value: string | null | undefined): value is FirstSource {
  return (FIRST_SOURCES as readonly string[]).includes(value ?? '');
}
