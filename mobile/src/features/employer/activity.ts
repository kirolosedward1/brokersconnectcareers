import { useInfiniteQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTranslations } from 'use-intl';
import { toCsv } from '@/lib/csv';
import { localized } from '@/lib/locale';
import type { ApplicationStatus, CompanyActivityRow, JobStatus } from '@/lib/supabase/database.types';
import { cairoDay } from '~/features/interviews/cairo-time';
import { supabase } from '~/lib/supabase';

/**
 * What the team did (Phase B 04, migration 377): newest first, a page at a
 * time, for six months. The database decides what a reader sees: a company
 * admin (the owner is one) reads everyone's and may narrow it to one
 * member, anybody else on the team reads their own whatever they ask for.
 */
export const ACTIVITY_PAGE_SIZE = 50;

type Cursor = { at: string; id: number } | null;

export function useCompanyActivity(member: string | null) {
  return useInfiniteQuery({
    queryKey: ['employer', 'activity', member],
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }): Promise<CompanyActivityRow[]> => {
      const { data, error } = await supabase.rpc('company_activity_page', {
        p_before: pageParam?.at ?? null,
        p_before_id: pageParam?.id ?? null,
        p_member: member,
        p_limit: ACTIVITY_PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []) as CompanyActivityRow[];
    },
    getNextPageParam: (last): Cursor => {
      const end = last.at(-1);
      return last.length === ACTIVITY_PAGE_SIZE && end ? { at: end.at, id: end.id } : null;
    },
  });
}

/** The words for the log, in the reader's language: what happened, and who did it. */
export function useActivityWords() {
  const t = useTranslations();
  return {
    /** What happened, in a few words, without the names (they are the line under it). */
    action(row: CompanyActivityRow): string {
      const to = typeof row.detail.to === 'string' ? row.detail.to : null;
      switch (row.kind) {
        case 'application_moved':
          return to
            ? t('app.activity.applicationMoved', { to: t(`applicationStatus.${to as ApplicationStatus}`) })
            : t('app.activity.applicationMovedPlain');
        case 'job_status':
          return to ? t('app.activity.jobMoved', { to: t(`jobStatus.${to as JobStatus}`) }) : t('app.activity.jobMovedPlain');
        case 'note_added':
          return t('app.activity.noteAdded');
        case 'interview_invited':
          return t('app.activity.interviewInvited');
        case 'contact_revealed':
          return t('app.activity.contactRevealed');
        case 'job_created':
          return t('app.activity.jobCreated');
        case 'member_added':
          return t('app.activity.memberAdded');
        case 'member_removed':
          return t('app.activity.memberRemoved');
        case 'member_changed':
          return t('app.activity.memberChanged');
        case 'order_paid':
          return t('app.activity.orderPaid');
        case 'owner_changed':
          return t('app.activity.ownerChanged');
        case 'deletion_requested':
          return t('app.activity.deletionRequested');
        case 'deletion_cancelled':
          return t('app.activity.deletionCancelled');
      }
    },
    /** Who did it: their name, a former member's dash, or "automatically" when nobody signed in did (a payment confirmed). */
    actor(row: CompanyActivityRow): string {
      if (row.actor_name) return row.actor_name;
      return row.actor_id ? '—' : t('app.activity.automatic');
    },
    header: [t('app.activity.csvWhen'), t('app.activity.csvWho'), t('app.activity.csvWhat'), t('app.activity.csvAbout')],
    dialogTitle: t('app.activity.export'),
  };
}

export type ActivityWords = ReturnType<typeof useActivityWords>;

/** Who or what it was about: the candidate and the listing, a colleague, a consultant. Null when it is gone. */
export function activitySubject(locale: string, row: CompanyActivityRow): string | null {
  const job = row.job_title_ar ? localized(locale, row.job_title_ar, row.job_title_en) : null;
  const parts = [row.candidate_name, row.subject_name, row.agent_name, job].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' · ') : null;
}

const clock =new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "2026-10-30 13:04", Cairo time: what a spreadsheet sorts and reads in any language. */
export function cairoStamp(at: string): string {
  const date = new Date(at);
  return `${cairoDay(date)} ${clock.format(date)}`;
}

/** Every row of the six months the reader may see, a large page at a time, for the file. */
async function everyRow(member: string | null): Promise<CompanyActivityRow[]> {
  const rows: CompanyActivityRow[] = [];
  let cursor: Cursor = null;
  for (;;) {
    const { data, error } = await supabase.rpc('company_activity_page', {
      p_before: cursor?.at ?? null,
      p_before_id: cursor?.id ?? null,
      p_member: member,
      p_limit: 500,
    });
    if (error) throw error;
    const page = (data ?? []) as CompanyActivityRow[];
    rows.push(...page);
    const end = page.at(-1);
    if (page.length < 500 || !end) return rows;
    cursor = { at: end.at, id: end.id };
  }
}

/**
 * The log as a spreadsheet, handed to the share sheet (to Files, mail or
 * WhatsApp), as the account's own copy is. Written to the cache and deleted
 * once the sheet closes: it names candidates.
 */
export async function shareActivity(words: ActivityWords, locale: string, member: string | null): Promise<void> {
  const rows = await everyRow(member);
  const csv = toCsv([
    words.header,
    ...rows.map((row) => [cairoStamp(row.at), words.actor(row), words.action(row), activitySubject(locale, row)]),
  ]);
  const file = new File(Paths.cache, `brokers-connect-team-activity-${cairoDay(new Date())}.csv`);
  if (file.exists) file.delete();
  file.create();
  await file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: words.dialogTitle }).finally(() => {
    try {
      file.delete();
    } catch {
      // Gone already.
    }
  });
}
