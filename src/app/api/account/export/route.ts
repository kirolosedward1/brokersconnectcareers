import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // The company through membership, the way every other read resolves it: a
  // recruiter's export used to say they had no company.
  // Allowed to fail quietly: the export is about the person, and a company
  // section that could not be resolved is left out rather than failing it.
  const { data: companyId } = await supabase.rpc('my_company_id');

  const [profile, agentProfile, applications, savedJobs, company] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('agent_profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('applications')
      .select('id, status, created_at, experience_band, note, cv_path, job:jobs (title_ar, slug)')
      .eq('candidate_id', user.id),
    supabase.from('saved_jobs').select('created_at, job:jobs (title_ar, slug)').eq('candidate_id', user.id),
    companyId
      ? supabase.from('companies').select('*').eq('id', companyId).maybeSingle()
      : Promise.resolve({ data: null }),
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
