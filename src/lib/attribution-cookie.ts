/**
 * The first visit, kept on the device until an account exists to put it on.
 *
 * A cookie and a copy in localStorage, for 180 days. Whichever is already
 * there wins: a later page, a later campaign, a later referrer does not
 * overwrite it. The value is the raw signals, not yet a source — the server
 * classifies them, so the browser and the database cannot disagree.
 */

import { landingPathOf, type RawTouch } from '@/lib/attribution';

export const FIRST_TOUCH_COOKIE = 'bc_touch';
export const FIRST_TOUCH_STORAGE = 'bc_touch';
export const FIRST_TOUCH_DAYS = 180;

const MAX_AGE = FIRST_TOUCH_DAYS * 24 * 60 * 60;
const MAX_LENGTH = 600;

type Stored = {
  r?: string;
  s?: string;
  m?: string;
  c?: string;
  g?: 1;
  f?: 1;
  p?: string;
  a?: 1;
  t?: string;
};

function clip(value: string | null | undefined, max: number): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

export function serialiseTouch(raw: RawTouch): string | null {
  const stored: Stored = {};
  const referrer = clip(raw.referrer, 300);
  const source = clip(raw.utmSource, 80);
  const medium = clip(raw.utmMedium, 80);
  const campaign = clip(raw.utmCampaign, 120);
  const path = landingPathOf(raw.landingPath) ?? undefined;
  if (referrer) stored.r = referrer;
  if (source) stored.s = source;
  if (medium) stored.m = medium;
  if (campaign) stored.c = campaign;
  if (raw.gclid) stored.g = 1;
  if (raw.fbclid) stored.f = 1;
  if (path) stored.p = path;
  if (raw.inApp) stored.a = 1;
  if (raw.seenAt && /^\d{4}-\d{2}-\d{2}T/.test(raw.seenAt)) stored.t = raw.seenAt.slice(0, 40);
  const json = JSON.stringify(stored);
  return json.length <= MAX_LENGTH ? json : null;
}

export function parseTouch(value: string | null | undefined): RawTouch | null {
  if (!value || value.length > MAX_LENGTH) return null;
  try {
    const stored = JSON.parse(value) as Stored;
    if (!stored || typeof stored !== 'object') return null;
    const raw: RawTouch = {
      referrer: typeof stored.r === 'string' ? stored.r : null,
      utmSource: typeof stored.s === 'string' ? stored.s : null,
      utmMedium: typeof stored.m === 'string' ? stored.m : null,
      utmCampaign: typeof stored.c === 'string' ? stored.c : null,
      gclid: stored.g === 1,
      fbclid: stored.f === 1,
      landingPath: typeof stored.p === 'string' ? stored.p : null,
      inApp: stored.a === 1,
      seenAt: typeof stored.t === 'string' ? stored.t : null,
    };
    const empty = !raw.referrer && !raw.utmSource && !raw.utmMedium && !raw.utmCampaign && !raw.gclid && !raw.fbclid && !raw.landingPath && !raw.inApp && !raw.seenAt;
    return empty ? null : raw;
  } catch {
    return null;
  }
}

/** Read `bc_touch` out of a Cookie header. A different cookie that merely contains the name does not count. */
export function touchFromCookieHeader(header: string | null | undefined): RawTouch | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== FIRST_TOUCH_COOKIE) continue;
    return parseTouch(decodeURIComponent(trimmed.slice(eq + 1)));
  }
  return null;
}

export function touchCookieAssignment(raw: RawTouch, secure: boolean): string | null {
  const value = serialiseTouch(raw);
  if (!value) return null;
  return `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
