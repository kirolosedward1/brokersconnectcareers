import { NextResponse } from 'next/server';
import { createPublicClient } from '@/lib/supabase/public';
import { isPlaceholder } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Is this deployment actually able to serve?
 *
 * "The page loaded" is not the same question. Every page on this site degrades
 * rather than fails when the database is unreachable — the middleware treats
 * the request as anonymous, the sitemap emits its static routes, the header
 * renders signed out — which is right for a visitor and useless for knowing
 * whether anything is wrong. This is the endpoint that answers plainly.
 *
 * Booleans only. A health check is unauthenticated by definition, so it must
 * not become a way to read the configuration: it says whether a thing is set
 * and whether a round trip worked, never what the value is or what the error
 * said. A wrong answer here is a probe telling somebody the shape of the
 * system.
 *
 * 200 when the platform can do its job, 503 when it cannot — so an uptime
 * monitor can watch one URL and a status code rather than parse the body.
 */
export async function GET() {
  const started = Date.now();

  // Configuration first: an unset variable is the failure that looks like a
  // database outage, and the two need telling apart at a glance.
  // `set` rather than Boolean: a REPLACE_ME placeholder from the Vercel import
  // file is present but useless, and reporting it as configured would hide the
  // exact failure this endpoint exists to name.
  const set = (value: string | undefined) => !isPlaceholder(value);

  const configured = {
    supabase: set(process.env.NEXT_PUBLIC_SUPABASE_URL) && set(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serviceRole: set(process.env.SUPABASE_SERVICE_ROLE_KEY),
    siteUrl: set(process.env.NEXT_PUBLIC_SITE_URL),
    email: set(process.env.RESEND_API_KEY) && set(process.env.RESEND_FROM),
    emailWebhook: set(process.env.RESEND_WEBHOOK_SECRET),
    cron: set(process.env.CRON_SECRET),
  };

  // One real round trip, against a table every page depends on, through the
  // anon key so it exercises the same path a visitor does — RLS included.
  let database = false;
  try {
    const { error } = await createPublicClient()
      .from('districts')
      .select('id', { head: true, count: 'exact' })
      .limit(1);
    database = !error;
  } catch {
    database = false;
  }

  // The site is servable without a mailer; it is not servable without a
  // database, and an unconfigured Supabase is the same outage by another name.
  const healthy = database && configured.supabase;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      configured,
      ms: Date.now() - started,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
