import { useQuery } from '@tanstack/react-query';
import { canAccessEmployerArea } from '@/lib/permissions';
import type { JobStatus } from '@/lib/supabase/database.types';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/** The longest stretch the daily chart draws. */
export const STATS_DAYS = 30;

export type ListingStats = {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string | null;
  status: JobStatus;
  view_count: number;
  published_at: string | null;
  expires_at: string | null;
  district: { name_ar: string; name_en: string } | null;
  applications: number;
  /** One per Cairo day, oldest first, ending today: the applications made that day. */
  days: { d: string; applications: number }[];
};

const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Cairo calendar day an instant falls on, as YYYY-MM-DD. */
export function cairoDayOf(date: Date): string {
  const parts = dayFormat.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The last `count` Cairo days, oldest first, each with the applications made on it. */
export function dailyApplications(createdAt: readonly string[], now: Date, count = STATS_DAYS): { d: string; applications: number }[] {
  const byDay = new Map<string, number>();
  for (const at of createdAt) {
    const day = cairoDayOf(new Date(at));
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  // Counted back on the calendar from today's Cairo date, not in steps of 24
  // hours: across the night the clocks change, a step skipped or repeated a day.
  const today = new Date(`${cairoDayOf(now)}T12:00:00Z`);
  const days: { d: string; applications: number }[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - back);
    const d = day.toISOString().slice(0, 10);
    days.push({ d, applications: byDay.get(d) ?? 0 });
  }
  return days;
}

/**
 * One listing's performance (the ListingStats board), from what the company
 * may already read: the listing with its views and applicant count, and the
 * applications of the last thirty days, counted by Cairo day. Views are
 * kept only as a total, so the chart is applications; the board's daily
 * views and category average have nothing behind them yet (Phase B notes).
 */
export function useListingStats(jobId: string) {
  const { viewer, actor } = useSession();
  const companyId = canAccessEmployerArea(actor) ? (viewer?.company?.id ?? null) : null;
  return useQuery({
    queryKey: ['employer', 'listing-stats', companyId, jobId],
    enabled: Boolean(companyId && jobId),
    queryFn: async (): Promise<ListingStats | null> => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, slug, title_ar, title_en, status, view_count, published_at, expires_at, district:districts (name_ar, name_en), applications (count)')
        .eq('id', jobId)
        .eq('company_id', companyId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as Omit<ListingStats, 'applications' | 'days'> & { applications: { count: number }[] };
      const now = new Date();
      const since = new Date(now.getTime() - STATS_DAYS * 86_400_000).toISOString();
      const recent = await supabase.from('applications').select('created_at').eq('job_id', jobId).gte('created_at', since).limit(5000);
      if (recent.error) throw recent.error;
      return {
        ...row,
        applications: row.applications?.[0]?.count ?? 0,
        days: dailyApplications(
          (recent.data ?? []).map((application) => application.created_at as string),
          now,
        ),
      };
    },
  });
}
