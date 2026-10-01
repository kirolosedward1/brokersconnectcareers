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

  /*
    Everything held about the person that is theirs to have: their own rows,
    and what others did with their data that they are entitled to know (which
    company asked for their number). Not other people's data — an employer's
    private notes about an applicant, a moderator's notes, who viewed a
    profile — and not the platform's own secrets (the unsubscribe token).

    A section that cannot be read comes back empty rather than failing the
    whole copy: a table a database has not had its migration for yet is a
    smaller export, not a broken one.
  */
  const [
    profile,
    agentProfile,
    applications,
    savedJobs,
    savedSearches,
    company,
    memberships,
    notifications,
    reportsFiled,
    supportRequests,
    appeals,
    pushDevices,
    agreements,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('agent_profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('applications')
      .select(
        'id, status, created_at, experience_band, note, decision_note, cv_path, job:jobs (title_ar, slug), history:application_events (from_status, to_status, created_at)',
      )
      .eq('candidate_id', user.id),
    supabase.from('saved_jobs').select('created_at, job:jobs (title_ar, slug)').eq('candidate_id', user.id),
    supabase.from('saved_searches').select('*').eq('candidate_id', user.id),
    supabase.from('companies').select('*').eq('owner_id', user.id).maybeSingle(),
    supabase.from('company_members').select('role, created_at, company:companies (name_ar, slug)').eq('user_id', user.id),
    supabase
      .from('notifications')
      .select('kind, payload, href, created_at, read_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('reports').select('*').eq('reporter_id', user.id),
    supabase.from('support_requests').select('*').eq('user_id', user.id),
    supabase.from('moderation_appeals').select('*').eq('appellant_id', user.id),
    supabase.from('push_devices').select('platform, locale, app_version, created_at, last_seen_at, disabled_at').eq('user_id', user.id),
    supabase.from('policy_acceptances').select('terms_version, privacy_version, accepted_at').eq('user_id', user.id),
  ]);

  const agentId = agentProfile.data?.id ?? null;
  const [experience, education, certifications, developers, contactRequests] = agentId
    ? await Promise.all([
        supabase.from('agent_experience').select('*').eq('agent_id', agentId),
        supabase.from('agent_education').select('*').eq('agent_id', agentId),
        supabase.from('agent_certifications').select('*').eq('agent_id', agentId),
        supabase.from('agent_developers').select('developer:developers (name_ar, name_en)').eq('agent_id', agentId),
        // Which company asked for this consultant's number or CV, and when —
        // theirs to know (migration 304's subject_read policy).
        supabase
          .from('agent_contact_reveals')
          .select('created_at, company:companies (name_ar, slug)')
          .eq('agent_id', agentId)
          .order('created_at', { ascending: false }),
      ])
    : [null, null, null, null, null];

  /*
    The files themselves, as links that work for an hour: a CV is the
    person's own upload, in their own folder, which row-level security lets
    them read. Paths outside their folder (none should be) are left out.
  */
  const ownPaths = [
    ...new Set(
      [agentProfile.data?.cv_path, ...(applications.data ?? []).map((row) => row.cv_path)].filter(
        (path): path is string => typeof path === 'string' && path.startsWith(`${user.id}/`),
      ),
    ),
  ];
  const files = await Promise.all(
    ownPaths.map(async (path) => {
      // A link that could not be made is said as null beside the path, which
      // still tells the person the file exists.
      const { data, error } = await supabase.storage.from('cvs').createSignedUrl(path, 3600, { download: true });
      return { path, download_url: error ? null : (data?.signedUrl ?? null) };
    }),
  );

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
    consultant_experience: experience?.data ?? [],
    consultant_education: education?.data ?? [],
    consultant_certifications: certifications?.data ?? [],
    consultant_developers: developers?.data ?? [],
    contact_requests: contactRequests?.data ?? [],
    applications: applications.data ?? [],
    saved_jobs: savedJobs.data ?? [],
    saved_searches: savedSearches.data ?? [],
    company: company.data ?? null,
    company_memberships: memberships.data ?? [],
    notifications: notifications.data ?? [],
    reports_filed: reportsFiled.data ?? [],
    support_requests: supportRequests.data ?? [],
    appeals: appeals.data ?? [],
    phones: pushDevices.data ?? [],
    agreements: agreements.data ?? [],
    files,
    note:
      'Your CV files are linked under "files"; each link works for one hour from exported_at. ' +
      'Your photo and your company logo are at the addresses in "profile" and "company". ' +
      'Verification documents are kept for review and are not included.',
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
