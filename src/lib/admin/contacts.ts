import { raise } from '@/lib/queries/error';
import type { ShownContact } from '@/components/admin/crm';

type ContactClient = {
  rpc: (
    fn: 'admin_view_contacts',
    args: { p_users: string[] },
  ) => PromiseLike<{
    data: { user_id: string; email: string | null; whatsapp_phone: string; email_confirmed: boolean }[] | null;
    error: { message?: string; code?: string | null } | null;
  }>;
};

/**
 * Email and phone for the accounts on this page.
 *
 * The database writes the audit row in the same call, and refuses anyone who
 * is not an admin. A database that does not have the function yet answers
 * with an empty map: the rest of the page still opens.
 */
export async function shownContacts(supabase: ContactClient, ids: string[]): Promise<Map<string, ShownContact>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, ShownContact>();
  if (!unique.length) return out;

  const { data, error } = await supabase.rpc('admin_view_contacts', { p_users: unique });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return out;
    raise(error, 'reading contact details');
  }
  for (const row of data ?? []) {
    out.set(row.user_id, {
      email: row.email,
      phone: row.whatsapp_phone,
      emailConfirmed: row.email_confirmed,
    });
  }
  return out;
}
