'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { parseTouch, FIRST_TOUCH_COOKIE } from '@/lib/attribution-cookie';
import { writeFirstTouch, ownHosts } from '@/lib/attribution-write';
import type { RawTouch } from '@/lib/attribution';

const touchSchema = z.object({
  referrer: z.string().max(300).nullable().optional(),
  utmSource: z.string().max(80).nullable().optional(),
  utmMedium: z.string().max(80).nullable().optional(),
  utmCampaign: z.string().max(120).nullable().optional(),
  gclid: z.boolean().optional(),
  fbclid: z.boolean().optional(),
  landingPath: z.string().max(200).nullable().optional(),
  inApp: z.boolean().optional(),
  seenAt: z.string().max(40).nullable().optional(),
});

function rawFromPayload(input: z.infer<typeof touchSchema>): RawTouch {
  return {
    referrer: input.referrer,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    gclid: input.gclid,
    fbclid: input.fbclid,
    landingPath: input.landingPath,
    inApp: input.inApp,
    seenAt: input.seenAt,
  };
}

/** The visit stored on this browser, if the capture has run. */
export async function storedTouch(): Promise<RawTouch | null> {
  const jar = await cookies();
  return parseTouch(jar.get(FIRST_TOUCH_COOKIE)?.value ?? null);
}

/**
 * Put the first visit on the signed-in profile, once.
 *
 * The body is what the device stored. When it is absent, the cookie is read
 * instead. Nothing is written for a signed-out request.
 */
export async function saveFirstTouch(input?: unknown): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const parsed = touchSchema.safeParse(input ?? {});
  const fromBody = parsed.success ? rawFromPayload(parsed.data) : null;
  const raw = fromBody?.seenAt || fromBody?.inApp || fromBody?.referrer || fromBody?.utmSource ? fromBody : await storedTouch();
  if (!raw) return { ok: true };

  const ok = await writeFirstTouch(supabase, user.id, raw, ownHosts());
  return { ok };
}
