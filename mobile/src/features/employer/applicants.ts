import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { canAccessEmployerArea } from '@/lib/permissions';
import type {
  ApplicationNoteRow,
  ApplicationStatus,
  ExperienceBand,
  JobStatus,
  JobTrack,
} from '@/lib/supabase/database.types';
import { EXPERIENCE_BANDS, JOB_TRACKS } from '@/lib/taxonomy';
import { callAction, getJson } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The company's applicants — the website's per-listing pipeline and its
 * cross-listing inbox, read as those pages read them (the newest two hundred,
 * under the employer's own session), with the private notes, the status
 * moves, the "seen" stamp the candidate's "opened" comes from, and the CV.
 */

export const APPLICANTS_CAP = 200;
export const STAGES: readonly ApplicationStatus[] = ['new', 'shortlisted', 'interview', 'hired', 'rejected'];

export type ApplicantProfile = {
  slug: string;
  headline_ar: string | null;
  headline_en: string | null;
  years_experience: number;
  tracks: JobTrack[];
  district_ids: number[];
  units_closed: number | null;
  volume_egp: number | null;
};

export type Applicant = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  note: string | null;
  decision_note: string | null;
  cv_path: string | null;
  experience_band: ExperienceBand | null;
  employer_viewed_at: string | null;
  candidate: {
    full_name: string;
    whatsapp_phone: string;
    avatar_url: string | null;
    /**
     * Null when there is no directory profile — and when there is one this
     * company may not see: row-level security drops a hidden profile (or a
     * verified-only one, for an unverified company) before it is returned.
     */
    agent_profiles: ApplicantProfile | null;
  } | null;
  /** On the inbox, which listing it was for. */
  job?: { id: string; title_ar: string; title_en: string | null; track: JobTrack } | null;
};

const CANDIDATE = `
  full_name, whatsapp_phone, avatar_url,
  agent_profiles ( slug, headline_ar, headline_en, years_experience, tracks, district_ids, units_closed, volume_egp )
`;
const APPLICATION = 'id, status, created_at, note, decision_note, cv_path, experience_band, employer_viewed_at';

/** One profile per person, whichever shape the embed came back in. */
function normalise(rows: unknown[]): Applicant[] {
  return (rows as Applicant[]).map((row) => {
    const profiles = row.candidate?.agent_profiles as unknown;
    const profile = Array.isArray(profiles) ? ((profiles[0] as ApplicantProfile | undefined) ?? null) : (profiles as ApplicantProfile | null);
    return row.candidate ? { ...row, candidate: { ...row.candidate, agent_profiles: profile ?? null } } : row;
  });
}

function useCompanyId(): string | null {
  const { viewer, actor } = useSession();
  return canAccessEmployerArea(actor) ? (viewer?.company?.id ?? null) : null;
}

export type ListingPipeline = {
  job: { id: string; slug: string; title_ar: string; title_en: string | null; status: JobStatus };
  applicants: Applicant[];
  total: number;
};

/** One listing and its newest two hundred applicants, with the exact total. Null when it is not the company's. */
export function useListingApplicants(jobId: string) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: ['employer', 'applicants', 'listing', jobId, companyId],
    enabled: Boolean(companyId && jobId),
    queryFn: async (): Promise<ListingPipeline | null> => {
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('id, slug, title_ar, title_en, status')
        .eq('id', jobId)
        .eq('company_id', companyId as string)
        .maybeSingle();
      if (jobError) throw jobError;
      if (!job) return null;
      const { data, error, count } = await supabase
        .from('applications')
        .select(`${APPLICATION}, candidate:profiles ( ${CANDIDATE} )`, { count: 'exact' })
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(APPLICANTS_CAP);
      if (error) throw error;
      const applicants = normalise(data ?? []);
      return { job: job as ListingPipeline['job'], applicants, total: count ?? applicants.length };
    },
  });
}

export type InboxFilters = {
  stage: ApplicationStatus | null;
  job: string | null;
  q: string;
  band: ExperienceBand | null;
  track: JobTrack | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address's filters as the website reads them: unknown values ignored, the search trimmed and capped. */
export function parseInboxFilters(params: Record<string, string | string[] | undefined>): InboxFilters {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? '') : '';
  };
  const stage = one('stage');
  const band = one('band');
  const track = one('track');
  const job = one('job');
  return {
    stage: (STAGES as readonly string[]).includes(stage) ? (stage as ApplicationStatus) : null,
    job: UUID.test(job) ? job : null,
    q: one('q').trim().slice(0, 80),
    band: (EXPERIENCE_BANDS as readonly string[]).includes(band) ? (band as ExperienceBand) : null,
    track: (JOB_TRACKS as readonly string[]).includes(track) ? (track as JobTrack) : null,
  };
}

/** A name to search for, with LIKE's own characters taken literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export type Inbox = { rows: Applicant[]; counts: Record<ApplicationStatus, number>; any: number };

/**
 * Every applicant across the company's listings, newest first, narrowed by
 * the filters — and, beside it, how many each stage holds under the same
 * filters but any stage, which is what the stage chips count.
 */
export function useInbox(filters: InboxFilters, { enabled = true }: { enabled?: boolean } = {}) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: ['employer', 'applicants', 'inbox', companyId, filters],
    enabled: enabled && Boolean(companyId),
    queryFn: async (): Promise<Inbox> => {
      const narrow = <Q extends { eq: (c: string, v: string) => Q; ilike: (c: string, v: string) => Q }>(query: Q) => {
        let next = query.eq('job.company_id', companyId as string);
        if (filters.job) next = next.eq('job_id', filters.job);
        if (filters.q) next = next.ilike('candidate.full_name', likePattern(filters.q));
        if (filters.band) next = next.eq('experience_band', filters.band);
        if (filters.track) next = next.eq('job.track', filters.track);
        return next;
      };

      let main = narrow(
        supabase
          .from('applications')
          .select(`${APPLICATION}, candidate:profiles!inner ( ${CANDIDATE} ), job:jobs!inner (id, title_ar, title_en, track)`),
      );
      if (filters.stage) main = main.eq('status', filters.stage);

      const [rows, stages] = await Promise.all([
        main.order('created_at', { ascending: false }).limit(APPLICANTS_CAP),
        narrow(supabase.from('applications').select('status, candidate:profiles!inner (full_name), job:jobs!inner (track)')).limit(2000),
      ]);
      if (rows.error) throw rows.error;
      if (stages.error) throw stages.error;

      const counts = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<ApplicationStatus, number>;
      for (const row of (stages.data ?? []) as { status: ApplicationStatus }[]) counts[row.status] += 1;
      return { rows: normalise(rows.data ?? []), counts, any: (stages.data ?? []).length };
    },
  });
}

export type Notes = { byApplication: Record<string, ApplicationNoteRow[]>; authors: Record<string, string> };

/**
 * The company's own notes on these applicants, oldest first, and who wrote
 * them. A colleague's name is often unreadable (profiles are private); the
 * card then says "a former colleague", as the website does.
 */
export function useApplicantNotes(applicationIds: string[]) {
  const key = [...applicationIds].sort().join(',');
  return useQuery({
    queryKey: ['employer', 'notes', key],
    enabled: applicationIds.length > 0,
    queryFn: async (): Promise<Notes> => {
      const { data, error } = await supabase
        .from('application_notes')
        .select('*')
        .in('application_id', applicationIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const notes = (data ?? []) as ApplicationNoteRow[];
      const byApplication: Record<string, ApplicationNoteRow[]> = {};
      for (const note of notes) (byApplication[note.application_id] ??= []).push(note);

      const authorIds = [...new Set(notes.map((note) => note.author_id).filter((id): id is string => Boolean(id)))];
      const authors: Record<string, string> = {};
      if (authorIds.length) {
        // Allowed to fail quietly: a name missing reads as a former colleague.
        const { data: members } = await supabase
          .from('company_members')
          .select('user_id, profile:profiles (full_name)')
          .in('user_id', authorIds);
        for (const member of (members ?? []) as unknown as { user_id: string; profile: { full_name: string } | null }[]) {
          if (member.profile?.full_name) authors[member.user_id] = member.profile.full_name;
        }
      }
      return { byApplication, authors };
    },
  });
}

/**
 * Stamps the applicants on screen as seen by the company — the website does it
 * as it renders them — which is where the candidate's "the company opened it"
 * comes from. Once per applicant per screen, and never in the way: the answer
 * is always ok.
 *
 * Only while the screen is the one in front. The native tab bar draws every
 * tab's first screen at launch, hidden, and a screen left under another keeps
 * reading: stamped from there, applicants nobody had looked at were told the
 * company opened their application, at every launch.
 */
export function useMarkSeen(applicants: Applicant[] | undefined) {
  const onScreen = useIsFocused();
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (!onScreen) return;
    const ids = (applicants ?? [])
      .filter((row) => !row.employer_viewed_at && !sent.current.has(row.id))
      .map((row) => row.id)
      .slice(0, APPLICANTS_CAP);
    if (!ids.length) return;
    for (const id of ids) sent.current.add(id);
    void callAction('markApplicantsSeen', { ids }).catch(() => {});
  }, [applicants, onScreen]);
}

/** A colleague moved this applicant first; their move stands. */
export class MovedAlready extends Error {
  constructor() {
    super('moved_already');
    this.name = 'MovedAlready';
  }
}

/**
 * Move an applicant — the website's setApplicationStatus, with the stage the
 * card was showing as `from`, so a colleague's move in between is reported
 * rather than overwritten, and always with the decision note (the action
 * writes it on every move).
 */
export function useSetApplicationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { applicationId: string; status: ApplicationStatus; decisionNote: string; from: ApplicationStatus }) => {
      const result = await callAction('setApplicationStatus', {
        applicationId: input.applicationId,
        status: input.status,
        decisionNote: input.decisionNote.trim() || null,
        from: input.from,
      });
      if (!result.ok) throw result.error === 'moved_already' ? new MovedAlready() : new Error(result.error);
    },
    // The stages are read again before the move counts as settled, so the card
    // then shows what is stored (a colleague's move included). The overview's
    // and the listings' counts follow without holding the button.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['employer', 'summary'] });
      void queryClient.invalidateQueries({ queryKey: ['employer', 'trend'] });
      void queryClient.invalidateQueries({ queryKey: ['employer', 'listings'] });
      return queryClient.invalidateQueries({ queryKey: ['employer', 'applicants'] });
    },
  });
}

export function useAddNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { applicationId: string; body: string }) => {
      const result = await callAction('addApplicationNote', input);
      if (!result.ok) throw new Error(result.error);
      return result.data?.note ?? null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employer', 'notes'] }),
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const result = await callAction('deleteApplicationNote', { id });
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employer', 'notes'] }),
  });
}

/**
 * Open an applicant's CV: the website mints a five-minute signed address for
 * this person (JSON with the app's token), and the in-app browser shows it.
 */
export async function openApplicationCv(applicationId: string): Promise<void> {
  const { url } = await getJson<{ url: string }>(`/api/cv/${applicationId}`, { signedIn: true });
  await WebBrowser.openBrowserAsync(url);
}
