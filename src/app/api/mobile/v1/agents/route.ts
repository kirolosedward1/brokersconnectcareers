import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth';
import { canBrowseAgentDirectory } from '@/lib/permissions';
import { mobileJson, searchParamsOf, withMobileAuth } from '@/lib/mobile-api/http';
import { parseAgentFilters, queryAgents } from '@/lib/queries/agents';
import type { AgentDirectoryResponse } from '@/lib/mobile-api/reads';

/**
 * GET /api/mobile/v1/agents?q=&track=&district=&availability=&years=&page= —
 * the consultant directory, for the companies it exists for.
 *
 * Signed in, and only for a viewer the website would show the directory to
 * (canBrowseAgentDirectory: an approved employer or an admin, migration 322).
 * The database enforces the same rule inside search_agents(); asking first
 * lets the app say "not available to your account yet" rather than show an
 * empty directory that looks like nobody is looking for work.
 *
 * `no-store`: what each card reveals depends on the viewer's company.
 */
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async (request: NextRequest) => {
  const viewer = await getViewer();
  if (!canBrowseAgentDirectory(viewer)) return mobileJson({ error: 'directory_denied' }, { status: 403 });

  const result: AgentDirectoryResponse = await queryAgents(parseAgentFilters(searchParamsOf(request)));
  return mobileJson(result);
});
