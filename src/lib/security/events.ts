import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';

export type SecuritySeverity = 'info' | 'warning' | 'critical';

/**
 * Something the platform noticed, written where an admin can see it.
 *
 * Best-effort by construction: a security event is context for whoever
 * investigates, never the action itself, and a page must not fail because the
 * log could not be written. Everything personal arrives pre-hashed — see
 * hashSubject() — and `metadata` holds identifiers and counts, never text a
 * person typed.
 */
export async function recordSecurityEvent(
  kind: string,
  {
    severity = 'info',
    subject = null,
    metadata = {},
    actorId = null,
  }: {
    severity?: SecuritySeverity;
    subject?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
    actorId?: string | null;
  } = {},
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc('record_security_event', {
      p_kind: kind,
      p_severity: severity,
      p_subject_hash: subject,
      p_metadata: metadata,
      p_actor: actorId,
    });
    if (error) logFailure('security', 'event not recorded', { kind, code: error.code });
  } catch {
    logFailure('security', 'event not recorded', { kind, reason: 'no service role' });
  }
}
