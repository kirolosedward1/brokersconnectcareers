import { isPlaceholder } from '@/lib/env';
import { emailConfigured } from './send';

/**
 * Whether this deployment can send mail, and which variables stand in the
 * way when it cannot — their names only, never their values. The admin
 * email page shows it, and the app's console reads it through
 * /api/mobile/v1/admin/mail (an admin's alone), because a phone cannot look
 * at the server's environment itself.
 *
 * A REPLACE_ME placeholder from the Vercel import file counts as missing: it
 * is present, so every Boolean check passes, and nothing sends.
 */
export function mailStatus(): { configured: boolean; missing: string[] } {
  const missing = [
    ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
    ['RESEND_API_KEY', process.env.RESEND_API_KEY],
    ['RESEND_FROM', process.env.RESEND_FROM],
  ]
    .filter(([, value]) => isPlaceholder(value))
    .map(([name]) => name as string);
  return { configured: emailConfigured(), missing };
}
