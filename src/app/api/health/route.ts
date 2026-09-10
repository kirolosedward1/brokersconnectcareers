import { NextResponse } from 'next/server';
import { createPublicClient } from '@/lib/supabase/public';
import { isPlaceholder } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

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

  /*
    Why a variable is not configured, per variable.

    `configured` says something is wrong; it cannot say what to do about it,
    and the two causes need opposite actions. "absent" means the variable never
    reached this deployment — added to Preview instead of Production, or added
    after the last build and not redeployed. "placeholder" means it is present
    and still holds the REPLACE_ME value from .env.vercel.local, so the import
    worked and the real key was never pasted in.

    Chasing that distinction by guesswork cost a round of redeploys, so the
    endpoint answers it. Names only — never a value, not even a masked one:
    this route is public.
  */
  const attention: Record<string, 'absent' | 'placeholder' | 'rejected' | 'unverified'> = {};
  for (const name of [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SITE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'RESEND_API_KEY',
    'RESEND_FROM',
    'RESEND_WEBHOOK_SECRET',
    'CRON_SECRET',
  ]) {
    const value = process.env[name];
    if (!value) attention[name] = 'absent';
    else if (isPlaceholder(value)) attention[name] = 'placeholder';
  }

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

  /*
    Does the service-role key actually work, or is it merely present?

    Checking the string is non-empty answers a weaker question than this
    endpoint claims to answer. A key that has been rotated is still a long
    non-empty string, and every check here passed it while Supabase answered
    401 to everything that used it — which is exactly the state this project
    was in for an afternoon: local development reported serviceRole true while
    no admin call worked at all.

    listUsers rather than a table read, because a table read succeeds with any
    valid key and would prove nothing about privilege. Nothing is done with the
    result; only whether it was refused.
  */
  if (configured.serviceRole) {
    /*
      Bounded, because the failing path is the slow one. A rejected key takes
      seconds to come back — measured at 3.5s against a rotated key, against
      ~250ms for the whole endpoint before this check existed — and an uptime
      monitor watching this URL should not be held open by it.

      A timeout is reported as its own state rather than folded into either
      answer. "We could not check" is not "the key is bad", and claiming
      either would be inventing a result.
    */
    const verdict = await Promise.race([
      createAdminClient()
        .auth.admin.listUsers({ page: 1, perPage: 1 })
        .then(({ error }) => (error ? 'rejected' : 'ok'))
        .catch(() => 'rejected' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2500)),
    ]);

    if (verdict === 'rejected') {
      configured.serviceRole = false;
      attention.SUPABASE_SERVICE_ROLE_KEY = 'rejected';
    } else if (verdict === 'timeout') {
      attention.SUPABASE_SERVICE_ROLE_KEY = 'unverified';
    }
  }

  // The site is servable without a mailer; it is not servable without a
  // database, and an unconfigured Supabase is the same outage by another name.
  const healthy = database && configured.supabase;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      configured,
      // Omitted entirely when everything is in place, so a healthy response
      // stays as short as it was.
      ...(Object.keys(attention).length ? { attention } : {}),
      ms: Date.now() - started,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
