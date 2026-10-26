import { adminMfaRequired } from '@/lib/auth';
import { mailStatus } from '@/lib/email/status';
import { adminDoor } from '@/lib/mobile-api/admin-door';
import { mobileJson, withMobileAuth } from '@/lib/mobile-api/http';
import type { AdminMailStatus } from '@/lib/mobile-api/reads';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/mobile/v1/admin/mail — whether this deployment can send mail, and
 * the names of the variables in the way when it cannot (never their values).
 *
 * An admin's alone, behind the same door as the console's levers
 * (admin-door.ts): the website's email page reads the server's environment
 * itself, which a phone cannot, so the app's console asks here for its
 * mail-off banner and the email page's configuration notice. Anybody who is
 * not an admin is told `forbidden`, nothing more.
 */
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async (_request, _context, session) => {
  if (!session) return mobileJson({ error: 'unauthenticated' }, { status: 401 });
  const supabase = await createClient();
  const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
  // A role that could not be read is said so, never taken for "not an admin".
  if (error) return mobileJson({ error: 'unavailable' }, { status: 503 });
  if (profile?.role !== 'admin') return mobileJson({ error: 'forbidden' }, { status: 403 });
  const door = adminDoor(session, adminMfaRequired());
  if (door !== 'open') return mobileJson({ error: door }, { status: 403 });
  return mobileJson(mailStatus() satisfies AdminMailStatus);
});
