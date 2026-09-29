import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentProfileInput, MobileActions } from '@/lib/mobile-api/contract';
import { canAccessCandidateArea } from '@/lib/permissions';
import { clean } from '@/lib/security/sanitize';
import type {
  AgentCertificationRow,
  AgentEducationRow,
  AgentExperienceRow,
  AgentProfileRow,
  CandidateSummary,
} from '@/lib/supabase/database.types';
import { CvUploadFailed, removeCv, uploadCv, type PickedCv } from '~/features/cv/files';
import { callAction, refusedAtTheDoor } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The candidate's directory profile — the website's /dashboard/profile reads
 * and writes, on the phone. Reads go straight to Supabase, scoped to the
 * candidate explicitly (agent_profiles has four read policies, one of them
 * "public", so leaning on RLS alone matched other people's rows); every write
 * is the website's action.
 */

function useCandidateId(): string | null {
  const { session, actor } = useSession();
  return canAccessCandidateArea(actor) ? (session?.user.id ?? null) : null;
}

/**
 * The profile row and the developers ticked on it. A failed read is an error,
 * not "no profile yet": the empty form is for somebody who has not made one.
 */
export function useAgentProfile() {
  const candidateId = useCandidateId();
  return useQuery({
    queryKey: ['profile', 'agent', candidateId],
    enabled: Boolean(candidateId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_profiles')
        .select('*')
        .eq('user_id', candidateId as string)
        .maybeSingle();
      if (error) throw error;
      const agent = (data as AgentProfileRow | null) ?? null;
      if (!agent) return { agent: null, developerIds: [] as number[] };
      // Allowed to fail quietly, as on the website: the chips draw unticked
      // and the next save corrects them.
      const { data: developers } = await supabase.from('agent_developers').select('developer_id').eq('agent_id', agent.id);
      return { agent, developerIds: (developers ?? []).map((row) => row.developer_id as number) };
    },
  });
}

export type CvSections = {
  experience: AgentExperienceRow[];
  education: AgentEducationRow[];
  certifications: AgentCertificationRow[];
};

/** Work history, education and certifications, newest first as the website orders them. */
export function useCvSections(agentId: string | null) {
  return useQuery({
    queryKey: ['profile', 'cv', agentId],
    enabled: Boolean(agentId),
    queryFn: async (): Promise<CvSections> => {
      const id = agentId as string;
      const [experience, education, certifications] = await Promise.all([
        supabase.from('agent_experience').select('*').eq('agent_id', id).order('started', { ascending: false }),
        supabase.from('agent_education').select('*').eq('agent_id', id).order('graduated', { ascending: false }),
        supabase.from('agent_certifications').select('*').eq('agent_id', id).order('issued', { ascending: false }),
      ]);
      const failed = experience.error ?? education.error ?? certifications.error;
      if (failed) throw failed;
      return {
        experience: (experience.data ?? []) as AgentExperienceRow[],
        education: (education.data ?? []) as AgentEducationRow[],
        certifications: (certifications.data ?? []) as AgentCertificationRow[],
      };
    },
  });
}

/** profile_completeness(), the SQL the gaps list mirrors; null when it cannot be read. */
export function useCompleteness(agentId: string | null) {
  return useQuery({
    queryKey: ['profile', 'completeness', agentId],
    enabled: Boolean(agentId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('profile_completeness', { p_agent_id: agentId as string });
      return error || typeof data !== 'number' ? null : data;
    },
  });
}

/** candidate_summary(): the dashboard's figures, and the only route to profile views. */
export function useCandidateSummary() {
  const candidateId = useCandidateId();
  return useQuery({
    queryKey: ['candidate', 'summary', candidateId],
    enabled: Boolean(candidateId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('candidate_summary');
      return error ? null : ((data as CandidateSummary | null) ?? null);
    },
  });
}

/** Why a save did not happen, with the field it was about when the website said. */
export class SaveRefused extends Error {
  constructor(
    readonly reason: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(reason);
    this.name = 'SaveRefused';
  }
}

/** What the save does with the CV: keep the one on file, take it off, or send a new one. */
export type CvChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'file'; file: PickedCv };

export function useSaveAgentProfile() {
  const queryClient = useQueryClient();
  const userId = useSession().session?.user.id ?? null;

  return useMutation({
    mutationFn: async ({
      input,
      cv,
    }: {
      input: Omit<AgentProfileInput, 'cvPath' | 'removeCv'>;
      cv: CvChange;
    }) => {
      if (!userId) throw new SaveRefused('unauthenticated');
      const uploaded =
        cv.kind === 'file'
          ? await uploadCv(userId, cv.file).catch((error: unknown) => {
              throw error instanceof CvUploadFailed ? new SaveRefused(error.reason) : error;
            })
          : null;

      let result: Awaited<ReturnType<typeof callAction<'saveAgentProfile'>>>;
      try {
        result = await callAction('saveAgentProfile', { ...input, cvPath: uploaded, removeCv: cv.kind === 'remove' });
      } catch (error) {
        // Only a refusal at the door proves the profile was not saved with the
        // new file; with no answer it may have been, and taking the file out
        // would leave the profile pointing at nothing. One that nothing points
        // at is taken by the storage clean-up after a day.
        if (uploaded && refusedAtTheDoor(error)) await removeCv(uploaded);
        throw error;
      }
      if (!result.ok) {
        if (uploaded) await removeCv(uploaded);
        throw new SaveRefused(result.error, result.fieldErrors);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['candidate'] });
      // The name and number live on the account too, and the apply form offers the profile's CV.
      queryClient.invalidateQueries({ queryKey: ['viewer'] });
      queryClient.invalidateQueries({ queryKey: ['apply'] });
    },
  });
}

/** The objective and the sales record. */
export function useSaveRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MobileActions['saveProfileRecord']['input']) => {
      const result = await callAction('saveProfileRecord', input);
      if (!result.ok) throw new SaveRefused(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['candidate'] });
    },
  });
}

export type CvSection = 'experience' | 'education' | 'certification';

export type CvEntryInput =
  | { section: 'experience'; input: MobileActions['saveExperience']['input'] }
  | { section: 'education'; input: MobileActions['saveEducation']['input'] }
  | { section: 'certification'; input: MobileActions['saveCertification']['input'] };

/**
 * Whether the profile already holds this new entry, as the website stores it:
 * the same company, role and start; the same school, degree and year; the
 * same certificate, issuer and date. Asked when the answer to adding it was
 * lost — sent again, it went in twice. False when it cannot be read.
 */
async function entryStored(entry: CvEntryInput): Promise<boolean> {
  const [table, fields]: [string, Record<string, string | number | null>] =
    entry.section === 'experience'
      ? [
          'agent_experience',
          { company_name: clean(entry.input.companyName), title: clean(entry.input.title), started: entry.input.started },
        ]
      : entry.section === 'education'
        ? [
            'agent_education',
            {
              institution: clean(entry.input.institution),
              degree: clean(entry.input.degree) || null,
              graduated: entry.input.graduated ?? null,
            },
          ]
        : [
            'agent_certifications',
            { name: clean(entry.input.name), issuer: clean(entry.input.issuer) || null, issued: entry.input.issued || null },
          ];
  let query = supabase.from(table as 'agent_experience').select('id').eq('agent_id', entry.input.agentId);
  for (const [column, value] of Object.entries(fields)) {
    query = value === null ? query.is(column as never, null) : query.eq(column as never, value as never);
  }
  const { data, error } = await query.limit(1);
  return !error && Boolean(data?.length);
}

function sendCvEntry(entry: CvEntryInput) {
  return entry.section === 'experience'
    ? callAction('saveExperience', entry.input)
    : entry.section === 'education'
      ? callAction('saveEducation', entry.input)
      : callAction('saveCertification', entry.input);
}

/** Add a CV entry, or change one (the website's actions take an id for that). */
export function useSaveCvEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry: CvEntryInput) => {
      const result = await sendCvEntry(entry).catch(async (error: unknown) => {
        // A new entry with no answer may be in, and only the answer lost: the
        // database decides. A change sent again changes nothing twice.
        if (!entry.input.id && !refusedAtTheDoor(error) && (await entryStored(entry))) return { ok: true as const };
        throw error;
      });
      if (!result.ok) throw new SaveRefused(result.error, result.fieldErrors);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['candidate'] });
    },
  });
}

const LIST: Record<CvSection, keyof CvSections> = {
  experience: 'experience',
  education: 'education',
  certification: 'certifications',
};

/** Delete an entry at once, and put it back if the server says no. */
export function useDeleteCvEntry(agentId: string | null) {
  const queryClient = useQueryClient();
  const key = ['profile', 'cv', agentId];
  return useMutation({
    mutationFn: async ({ section, id }: { section: CvSection; id: string }) => {
      const result = await callAction('deleteCvEntry', { section, id });
      if (!result.ok) throw new SaveRefused(result.error);
    },
    onMutate: async ({ section, id }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<CvSections>(key);
      queryClient.setQueryData<CvSections>(key, (current) =>
        current
          ? { ...current, [LIST[section]]: (current[LIST[section]] as { id: string }[]).filter((row) => row.id !== id) }
          : current,
      );
      return () => queryClient.setQueryData(key, before);
    },
    onError: (_error, _input, restore) => restore?.(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['candidate'] });
    },
  });
}
