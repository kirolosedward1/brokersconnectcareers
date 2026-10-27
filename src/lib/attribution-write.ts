import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyTouch, hostOf, type RawTouch } from '@/lib/attribution';
import { env } from '@/lib/env';

/** A profile created this much before the visit can still be that visit's account. */
const SKEW_MS = 5 * 60 * 1000;

/**
 * Hosts that are this site. A referrer from one of them is not a source.
 * The request host is added by the caller when it has one.
 */
export function ownHosts(extra?: string | null): string[] {
  return [env.siteUrl, 'localhost', '127.0.0.1', extra ?? ''].filter(Boolean);
}

/**
 * Write the first visit onto a profile that does not have one yet.
 *
 * An account older than the visit is left unknown: the visit is not its first,
 * and a later session must not invent one. A missing column (the migration has
 * not been applied) returns false so the caller can try again later. Anything
 * else, including "already written", returns true.
 */
export async function writeFirstTouch(
  supabase: SupabaseClient,
  userId: string,
  raw: RawTouch,
  hosts: string[] = ownHosts(),
): Promise<boolean> {
  const seen = raw.seenAt ? Date.parse(raw.seenAt) : NaN;
  if (!Number.isFinite(seen)) return false;

  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('created_at, first_seen_at, first_source')
    .eq('id', userId)
    .maybeSingle();
  if (readError) {
    if (readError.code === '42703' || readError.code === 'PGRST204') return false;
    return true;
  }
  if (!profile) return false;
  if (profile.first_seen_at || profile.first_source) return true;

  const created = Date.parse(profile.created_at);
  if (!Number.isFinite(created) || created + SKEW_MS < seen) return true;

  const touch = classifyTouch(raw, hosts.map((host) => hostOf(host) ?? host));
  const { error } = await supabase
    .from('profiles')
    .update({
      first_source: touch.source,
      first_medium: touch.medium,
      first_campaign: touch.campaign,
      first_referrer: touch.referrer,
      first_landing_path: touch.landingPath,
      first_seen_at: new Date(seen).toISOString(),
    })
    .eq('id', userId)
    .is('first_seen_at', null);

  if (!error) return true;
  if (error.code === '42703' || error.code === 'PGRST204') return false;
  return true;
}
