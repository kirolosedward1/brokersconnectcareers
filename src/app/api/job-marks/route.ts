import { NextResponse } from 'next/server';
import { actorOf, getViewer } from '@/lib/auth';
import { canSaveJobs } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const headers = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
};

const ID = /^[0-9a-f-]{36}$/i;

/**
 * Which of the listings on this page the reader has applied to or saved.
 *
 * The board itself is the same for everyone and is cached that way. The
 * ticks are this reader's, so they are asked after the HTML is sent, and
 * only when a session cookie is already there.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  const actor = actorOf(viewer);
  if (!viewer?.profile || !canSaveJobs(actor)) {
    return NextResponse.json({ applied: [], saved: [], savable: false }, { headers });
  }

  const ids = [...new Set((new URL(request.url).searchParams.get('ids') ?? '').split(','))]
    .filter((id) => ID.test(id))
    .slice(0, 50);

  if (!ids.length) return NextResponse.json({ applied: [], saved: [], savable: true }, { headers });

  const supabase = await createClient();
  const [{ data: applied }, { data: saved }] = await Promise.all([
    supabase.from('applications').select('job_id, status').eq('candidate_id', viewer.userId).in('job_id', ids),
    supabase.from('saved_jobs').select('job_id').eq('candidate_id', viewer.userId).in('job_id', ids),
  ]);

  return NextResponse.json(
    {
      applied: (applied ?? []).filter((row) => row.status !== 'withdrawn').map((row) => row.job_id),
      saved: (saved ?? []).map((row) => row.job_id),
      savable: true,
    },
    { headers },
  );
}
