import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReplyHours } from '@/lib/supabase/database.types';
import { cairoDay } from '~/features/interviews/cairo-time';
import { callAction } from '~/lib/api';
import { supabase } from '~/lib/supabase';

/**
 * Whether a company takes applications now, and how and when it answers
 * (migration 378, Phase B 07a). Read straight off the company row, which is
 * public. A read that fails (a server from before the migration) says
 * nothing, and the pages then draw what they always drew: open.
 */
export type CompanyHiring = {
  status: 'open' | 'paused';
  pausedUntil: string | null;
  /** Open now: open, or a pause whose day has passed in Cairo. */
  open: boolean;
  whatsapp: string | null;
  replyHours: ReplyHours | null;
};

/** As company_is_hiring() decides it: a pause that named a day ends once that day has passed in Cairo. */
export function isHiringNow(status: 'open' | 'paused', pausedUntil: string | null, today = cairoDay(new Date())): boolean {
  return status === 'open' || (pausedUntil !== null && pausedUntil < today);
}

export function useCompanyHiring(companyId: string | null) {
  return useQuery({
    queryKey: ['companies', 'hiring', companyId],
    enabled: Boolean(companyId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CompanyHiring | null> => {
      const { data, error } = await supabase
        .from('companies')
        .select('hiring_status, paused_until, contact_whatsapp, reply_hours')
        .eq('id', companyId as string)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as { hiring_status?: 'open' | 'paused'; paused_until?: string | null; contact_whatsapp?: string | null; reply_hours?: ReplyHours | null };
      const status = row.hiring_status ?? 'open';
      const pausedUntil = row.paused_until ?? null;
      return {
        status,
        pausedUntil,
        open: isHiringNow(status, pausedUntil),
        whatsapp: row.contact_whatsapp ?? null,
        replyHours: row.reply_hours ?? null,
      };
    },
  });
}

export type HiringInput = {
  hiringStatus: 'open' | 'paused';
  pausedUntil: string | null;
  contactWhatsapp: string | null;
  replyHours: ReplyHours | null;
};

/** Why the settings did not save: a field the website refused, or anything else. */
export class HiringRefused extends Error {
  constructor(
    readonly reason: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(reason);
    this.name = 'HiringRefused';
  }
}

export function useSaveHiring(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: HiringInput) => {
      const result = await callAction('saveCompanyHiring', input);
      if (!result.ok) throw new HiringRefused(result.error, result.fieldErrors);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies', 'hiring', companyId] }),
  });
}

/** Sunday first, as reply_hours numbers them (0 = Sunday) and as the week runs in Egypt. */
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * The days as a short run: three or more in a row as a range ("Sun–Thu"),
 * the rest listed, joined with the language's own separator.
 */
export function dayRuns(days: readonly number[], name: (day: number) => string, separator: string): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i += 1) {
    if (i < sorted.length && sorted[i] === sorted[i - 1]! + 1) continue;
    const first = sorted[start]!;
    const last = sorted[i - 1]!;
    if (last - first >= 2) runs.push(`${name(first)}–${name(last)}`);
    else for (let day = first; day <= last; day += 1) runs.push(name(day));
    start = i;
  }
  return runs.join(separator);
}

/** A day's name in the reader's language: 4 January 2026 was a Sunday. */
export function weekdayName(day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-EG', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + day)));
}
