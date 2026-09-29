import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { policyFor, rateLimit } from '@/lib/security/rate-limit';
import { retryAfter } from '@/lib/security/request';
import { withOptionalBearer } from '@/lib/mobile-api/http';

export const dynamic = 'force-dynamic';

/**
 * "Give me a copy of my data" — the portability right, as a JSON download.
 *
 * Deliberately runs through the caller's own session rather than the service
 * role. Row-level security already knows exactly which rows belong to this
 * user, so the export cannot over-collect even if this file gets a query
 * wrong: a mistake here returns less data, never someone else's.
 *
 * JSON rather than PDF because the right is to a copy in a machine-readable
 * form, and a PDF of a table is not that.
 */
async function handle() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Five reads of everything in one day is a person; fifty is a loop, and
  // this is the most expensive read a single account can ask for.
  const limit = await rateLimit(
    `export:user:${user.id}`,
    await policyFor('export:user:day', { windowSeconds: 86400, max: 5 }),
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'retry-after': retryAfter(limit.retryAfterSeconds), 'cache-control': 'no-store' } },
    );
  }

  const [profile, agentProfile, applications, savedJobs, company] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('agent_profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('applications')
      .select('id, status, created_at, experience_band, note, cv_path, job:jobs (title_ar, slug)')
      .eq('candidate_id', user.id),
    supabase.from('saved_jobs').select('created_at, job:jobs (title_ar, slug)').eq('candidate_id', user.id),
    supabase.from('companies').select('*').eq('owner_id', user.id).maybeSingle(),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email ?? null,
      created_at: user.created_at,
      sign_in_provider: user.app_metadata?.provider ?? null,
    },
    profile: profile.data ?? null,
    consultant_profile: agentProfile.data ?? null,
    applications: applications.data ?? [],
    saved_jobs: savedJobs.data ?? [],
    company: company.data ?? null,
    note:
      'Files you uploaded (CV, logo, verification documents) are not embedded here. ' +
      'They remain downloadable from your account until it is deleted.',
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="brokers-connect-data-${user.id.slice(0, 8)}.json"`,
      // A copy of someone's personal data has no business in any cache.
      'Cache-Control': 'no-store, private',
    },
  });
}

/* The website's cookie, or the mobile app's bearer token — never both. */
export const GET = withOptionalBearer(handle);
