import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { isAdmin } from '@/lib/permissions';
import type {
  AdminAuditRow,
  AdminUserActivity,
  AdminUserFacts,
  AdminUserSearchRow,
  AgentVisibility,
  ApplicationStatus,
  ApprovalStatus,
  CompanyMemberRole,
  JobStatus,
  ModerationNoteRow,
  UserRole,
  VerificationStatus,
} from '@/lib/supabase/database.types';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { useAdminDoor } from './door';

/**
 * The accounts — the website's /admin/users, read the same way: the list from
 * admin_search_users (a name fragment, or an exact email, phone or id, never
 * carrying a phone or an email back), and one account's file from the tables
 * and functions its page reads. Every read is an admin's alone (queries.ts
 * says why), and waits for the console's door.
 */

export type AccountsView = 'pending' | 'all' | 'candidates' | 'employers' | 'admins' | 'suspended' | 'blocked';

export const ACCOUNTS_VIEWS: readonly AccountsView[] = ['pending', 'all', 'candidates', 'employers', 'admins', 'suspended', 'blocked'];

export const ACCOUNTS_PAGE_SIZE = 25;

type AccountsPage = { rows: AdminUserSearchRow[]; total: number };

function useOpen() {
  const { actor } = useSession();
  const door = useAdminDoor();
  return isAdmin(actor) && door.state === 'open';
}

/**
 * What each view asks admin_search_users for. `p_blocked` is sent only by the
 * view that needs it, as the website does: a database from before migration
 * 352 knows the function without that argument, and would refuse every view
 * that named it.
 */
function filtersFor(view: AccountsView): { p_role: UserRole | null; p_status: ApprovalStatus | null; p_blocked?: true } {
  switch (view) {
    case 'pending':
      return { p_role: null, p_status: 'pending' };
    case 'suspended':
      return { p_role: null, p_status: 'rejected' };
    case 'candidates':
      return { p_role: 'candidate', p_status: null };
    case 'employers':
      return { p_role: 'employer', p_status: null };
    case 'admins':
      return { p_role: 'admin', p_status: null };
    case 'blocked':
      return { p_role: null, p_status: null, p_blocked: true };
    default:
      return { p_role: null, p_status: null };
  }
}

/** The accounts of one view, matching a search if there is one, twenty-five at a time; waiting accounts first. */
export function useAccountList(view: AccountsView, query: string) {
  const open = useOpen();
  const needle = query.trim();
  return useInfiniteQuery({
    queryKey: ['admin', 'accounts', view, needle],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<AccountsPage> => {
      const { data, error } = await supabase.rpc('admin_search_users', {
        p_query: needle || null,
        ...filtersFor(view),
        p_limit: ACCOUNTS_PAGE_SIZE,
        p_offset: (pageParam - 1) * ACCOUNTS_PAGE_SIZE,
      });
      if (error) throw error;
      const rows = data ?? [];
      return { rows, total: Number(rows[0]?.total_count ?? 0) };
    },
    getNextPageParam: (last, pages) =>
      pages.length * ACCOUNTS_PAGE_SIZE < last.total && last.rows.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every account across the pages loaded so far, each once. */
export function flattenAccounts(pages: AccountsPage[] | undefined): AdminUserSearchRow[] {
  const seen = new Set<string>();
  const rows: AdminUserSearchRow[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

export type AccountProfile = {
  id: string;
  role: UserRole;
  full_name: string;
  avatar_url: string | null;
  locale: 'ar' | 'en';
  created_at: string;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  /** The reviewer's note lives on profile_private (migration 305), readable by admins alone. */
  private: { approval_note: string | null } | null;
};

export type AccountMembership = {
  role: CompanyMemberRole;
  created_at: string;
  company: {
    id: string;
    name_ar: string;
    name_en: string | null;
    verification_status: VerificationStatus;
    suspended_at: string | null;
  } | null;
};

export type AccountApplication = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  job: { id: string; title_ar: string; title_en: string | null; status: JobStatus } | null;
};

/** One account's file: everything the website's page shows, without the phone or the email (those are revealed, on the record). */
export type AccountFile = {
  profile: AccountProfile;
  facts: AdminUserFacts;
  activity: AdminUserActivity | null;
  memberships: AccountMembership[];
  agent: { id: string; slug: string; visibility: AgentVisibility; restricted_at: string | null } | null;
  applications: AccountApplication[];
  reportingBan: { reason: string; created_at: string } | null;
  audit: AdminAuditRow[];
  notes: ModerationNoteRow[];
};

/**
 * A missing function is a database before migration 355: the file is drawn
 * without what it would have said, rather than not at all.
 */
function notMigrated(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

export function useAccountFile(id: string | undefined) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'account', id],
    enabled: open && Boolean(id),
    queryFn: async (): Promise<AccountFile | null> => {
      const user = id as string;
      const profileRead = await supabase
        .from('profiles')
        .select('id, role, full_name, avatar_url, locale, created_at, approval_status, approved_at, private:profile_private (approval_note)')
        .eq('id', user)
        .maybeSingle();
      if (profileRead.error) throw profileRead.error;
      if (!profileRead.data) return null;
      const profile = profileRead.data as unknown as AccountProfile;

      const [facts, activity, memberships, agent, applications, reportingBan, audit, notes] = await Promise.all([
        supabase.rpc('admin_user_facts', { p_user: user }),
        supabase.rpc('admin_user_activity', { p_user: user }),
        supabase
          .from('company_members')
          .select('role, created_at, company:companies (id, name_ar, name_en, verification_status, suspended_at)')
          .eq('user_id', user),
        supabase.from('agent_profiles').select('id, slug, visibility, restricted_at').eq('user_id', user).maybeSingle(),
        supabase
          .from('applications')
          .select('id, status, created_at, job:jobs (id, title_ar, title_en, status)')
          .eq('candidate_id', user)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase.from('reporting_restrictions').select('reason, created_at').eq('user_id', user).maybeSingle(),
        supabase
          .from('admin_audit_log')
          .select('*')
          .eq('target_type', 'user')
          .eq('target_id', user)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('moderation_notes')
          .select('*')
          .eq('target_type', 'user')
          .eq('target_id', user)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (facts.error) throw facts.error;
      if (activity.error && !notMigrated(activity.error)) throw activity.error;
      if (memberships.error) throw memberships.error;
      if (agent.error) throw agent.error;
      if (applications.error) throw applications.error;
      if (reportingBan.error) throw reportingBan.error;
      if (audit.error) throw audit.error;
      if (notes.error) throw notes.error;

      return {
        profile,
        facts: (facts.data ?? {}) as AdminUserFacts,
        activity: activity.error ? null : ((activity.data ?? null) as AdminUserActivity | null),
        memberships: (memberships.data ?? []) as unknown as AccountMembership[],
        agent: (agent.data as AccountFile['agent']) ?? null,
        applications: (applications.data ?? []) as unknown as AccountApplication[],
        reportingBan: (reportingBan.data as AccountFile['reportingBan']) ?? null,
        audit: (audit.data ?? []) as AdminAuditRow[],
        notes: (notes.data ?? []) as ModerationNoteRow[],
      };
    },
  });
}
