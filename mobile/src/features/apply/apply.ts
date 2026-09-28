import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CV_BUCKET } from '@/lib/buckets';
import { fileExtension, fileType } from '@/lib/file-type';
import type { JobListItem } from '@/lib/job-list';
import { rankJobs } from '@/lib/match';
import type { ApplyInput } from '@/lib/mobile-api/contract';
import type { JobBoardResponse } from '@/lib/mobile-api/reads';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { callAction, getJson } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * Applying — the website's apply form and page (src/components/jobs/apply-form.tsx,
 * jobs/[slug]/apply/page.tsx), on the phone.
 *
 * A CV goes to the private `cvs` bucket from the phone, into the candidate's
 * own folder, before the application is written — the action wants a path,
 * not bytes — and the website's action then reads its first bytes and refuses
 * anything that is not really a PDF or a Word file. Every refusal after the
 * upload takes the file back out, so nothing sits in the bucket with nothing
 * pointing at it. A CV already on the candidate's profile can be sent instead:
 * it is in the same folder, and withdrawing never deletes a file the profile
 * still uses.
 */

export const MAX_CV_BYTES = 10 * 1024 * 1024;
export const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export type PickedCv = { uri: string; name: string; type: string };
export type Attachment = { kind: 'profile'; path: string } | { kind: 'file'; file: PickedCv } | null;

/** What the file checks can say, as the website's `validation.*` words. */
export type CvProblem = 'fileType' | 'fileTooLarge';

/** The system's document picker, for a PDF or a Word file, checked as the website's form checks it. */
export async function pickCv(): Promise<{ cv: PickedCv } | { problem: CvProblem } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: CV_TYPES, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  // A provider that reports no type, or octet-stream, is named by the extension.
  const type = fileType({ name: asset.name, type: asset.mimeType ?? '' });
  if (!CV_TYPES.includes(type)) return { problem: 'fileType' };
  if ((asset.size ?? 0) > MAX_CV_BYTES) return { problem: 'fileTooLarge' };
  return { cv: { uri: asset.uri, name: asset.name, type } };
}

/** Why an application did not go through, in the terms the form shows. */
export class ApplyRefused extends Error {
  constructor(
    /** An action error code ('already_applied', 'rate_limit', 'invalid', …), 'upload' or a CvProblem. */
    readonly reason: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(reason);
    this.name = 'ApplyRefused';
  }
}

async function uploadCv(userId: string, cv: PickedCv): Promise<string> {
  const bytes = await new File(cv.uri).arrayBuffer();
  if (bytes.byteLength > MAX_CV_BYTES) throw new ApplyRefused('fileTooLarge');
  // The extension from the type, not the name: a provider can hand over a name with none.
  const path = `${userId}/${crypto.randomUUID()}.${fileExtension({ name: cv.name, type: cv.type }, 'pdf')}`;
  const { error } = await supabase.storage.from(CV_BUCKET).upload(path, bytes, { upsert: false, contentType: cv.type });
  if (error) throw new ApplyRefused('upload');
  return path;
}

async function removeCv(path: string) {
  // Not worth reporting: the person is already being told it did not go through.
  await supabase.storage
    .from(CV_BUCKET)
    .remove([path])
    .catch(() => {});
}

/**
 * Whether this candidate has already applied, and the CV on their profile.
 * The first is read, never guessed: a failed read is an error, not "no" — a
 * second form after a first application only meets the unique index.
 */
export function useApplyContext(jobId: string | null) {
  const candidateId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['apply', 'context', jobId, candidateId],
    enabled: Boolean(jobId && candidateId),
    queryFn: async () => {
      const [existing, agent] = await Promise.all([
        supabase
          .from('applications')
          .select('id, created_at')
          .eq('job_id', jobId as string)
          .eq('candidate_id', candidateId as string)
          .maybeSingle(),
        supabase.from('agent_profiles').select('cv_path').eq('user_id', candidateId as string).maybeSingle(),
      ]);
      if (existing.error) throw existing.error;
      return {
        existing: existing.data as { id: string; created_at: string } | null,
        // Optional: without it the form simply offers a file.
        profileCv: (agent.error ? null : agent.data?.cv_path) ?? null,
      };
    },
  });
}

export function useApplyToJob() {
  const queryClient = useQueryClient();
  const userId = useSession().session?.user.id ?? null;

  return useMutation({
    mutationFn: async ({ input, attachment }: { input: Omit<ApplyInput, 'cvPath'>; attachment: Attachment }) => {
      if (!userId) throw new ApplyRefused('unauthenticated');
      const uploaded = attachment?.kind === 'file' ? await uploadCv(userId, attachment.file) : null;
      const cvPath = uploaded ?? (attachment?.kind === 'profile' ? attachment.path : null);

      let result: Awaited<ReturnType<typeof callAction<'applyToJob'>>>;
      try {
        result = await callAction('applyToJob', { ...input, cvPath });
      } catch (error) {
        if (uploaded) await removeCv(uploaded);
        throw error;
      }
      if (!result.ok) {
        if (uploaded) await removeCv(uploaded);
        throw new ApplyRefused(result.error, result.fieldErrors);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apply'] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['jobs', 'applied'] });
      queryClient.invalidateQueries({ queryKey: ['candidate'] });
    },
  });
}

/**
 * Two more roles to look at, the moment after applying — ranked against the
 * candidate's own stated tracks, districts and years by the website's
 * rankJobs, without this listing or anything already applied to.
 */
export function useNextRoles(jobId: string, enabled: boolean) {
  const candidateId = useSession().session?.user.id ?? null;
  const hidden = useHiddenCompanies();
  const query = useQuery({
    queryKey: ['apply', 'next', jobId, candidateId],
    enabled: enabled && Boolean(candidateId),
    queryFn: async () => {
      const [board, agent, mine] = await Promise.all([
        getJson<JobBoardResponse>('/api/mobile/v1/jobs'),
        supabase
          .from('agent_profiles')
          .select('tracks, district_ids, years_experience')
          .eq('user_id', candidateId as string)
          .maybeSingle(),
        supabase.from('applications').select('job_id').eq('candidate_id', candidateId as string),
      ]);
      const appliedTo = new Set((mine.data ?? []).map((row) => row.job_id as string));
      return rankJobs(
        board.jobs.filter((role) => role.id !== jobId && !appliedTo.has(role.id)),
        {
          tracks: agent.data?.tracks ?? null,
          districtIds: agent.data?.district_ids ?? null,
          yearsExperience: agent.data?.years_experience ?? null,
        },
      );
    },
  });

  const ranked = query.data?.ranked ?? [];
  const roles: JobListItem[] = withoutHidden(
    ranked.map((entry) => entry.job),
    hidden,
  ).slice(0, 2);
  return { roles, personalised: query.data?.personalised ?? false };
}
