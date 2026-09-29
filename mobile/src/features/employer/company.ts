import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { COMPANY_DOCS_BUCKET } from '@/lib/buckets';
import { fileExtension, fileType } from '@/lib/file-type';
import type { CompanyInput } from '@/lib/mobile-api/contract';
import { canAccessEmployerArea } from '@/lib/permissions';
import type { CompanyDocumentRow, CompanyMemberRole, OrderRow } from '@/lib/supabase/database.types';
import { uuid } from '@/lib/uuid';
import { formFile, PhotoRefused, type PickedPhoto } from '~/features/account/settings';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The company's own page — the website's /employer/company and
 * /employer/billing: the profile (saved on the version it was loaded at), the
 * logo, the verification papers, the team, and the balance. Writes are the
 * website's actions; the papers' bytes go to their private bucket first, as
 * the website's browser code sends them, and the action checks what arrived.
 */

export type TeamMember = { userId: string; name: string | null; role: CompanyMemberRole; isOwner: boolean };

export type CompanyPage = {
  documents: CompanyDocumentRow[];
  team: TeamMember[];
  /** The viewer's own role on the roster — what decides which controls are offered. */
  isAdmin: boolean;
};

function useCompany() {
  const { viewer, actor } = useSession();
  return canAccessEmployerArea(actor) ? (viewer?.company ?? null) : null;
}

/**
 * The papers (a company admin's to read) and the roster. A colleague's name
 * is often unreadable — profiles are private — and the roster then says
 * nothing for it, as the website does. `enabled: false` when a screen needs
 * it only in some states (the directory, to know who may verify).
 */
export function useCompanyPage({ enabled = true }: { enabled?: boolean } = {}) {
  const company = useCompany();
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['employer', 'company', company?.id ?? null],
    enabled: enabled && Boolean(company && userId),
    queryFn: async (): Promise<CompanyPage> => {
      const id = company?.id as string;
      const [documents, roster] = await Promise.all([
        supabase.from('company_documents').select('*').eq('company_id', id).order('created_at', { ascending: false }),
        supabase
          .from('company_members')
          .select('user_id, role, created_at, profile:profiles (full_name)')
          .eq('company_id', id)
          .order('created_at', { ascending: true }),
      ]);
      if (roster.error) throw roster.error;
      const rows = (roster.data ?? []) as unknown as {
        user_id: string;
        role: CompanyMemberRole;
        profile: { full_name: string } | null;
      }[];
      return {
        // Readable by a company admin only; anybody else simply has none to show.
        documents: (documents.data ?? []) as CompanyDocumentRow[],
        team: rows.map((row) => ({
          userId: row.user_id,
          name: row.profile?.full_name ?? null,
          role: row.role,
          isOwner: row.user_id === company?.owner_id,
        })),
        isAdmin: rows.some((row) => row.user_id === userId && row.role === 'admin'),
      };
    },
  });
}

/** Why the profile did not save: a colleague saved first, a field the schema refused, or anything else. */
export class CompanyRefused extends Error {
  constructor(
    readonly reason: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(reason);
    this.name = 'CompanyRefused';
  }
}

export function useSaveCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CompanyInput) => {
      const result = await callAction('saveCompany', input);
      if (!result.ok) throw new CompanyRefused(result.error, result.fieldErrors);
    },
    // The company row is part of who the viewer is: a new one, or a new version.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['viewer'] });
      queryClient.invalidateQueries({ queryKey: ['employer'] });
    },
  });
}

/** The logo, through the website's uploadImage (kind "logo"), which keeps only the pixels. */
export function useUploadLogo(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (logo: PickedPhoto) => {
      const form = new FormData();
      form.append('kind', 'logo');
      form.append('companyId', companyId);
      form.append('file', formFile(logo));
      const result = await callAction('uploadImage', form);
      if (!result.ok) {
        throw new PhotoRefused(result.error === 'file_type' || result.error === 'too_large' ? result.error : 'failed');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['viewer'] }),
  });
}

export function useRemoveLogo(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await callAction('saveCompanyLogo', { companyId, storagePath: null });
      if (!result.ok) throw new PhotoRefused('failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['viewer'] }),
  });
}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export type DocType = 'commercial_register' | 'tax_card';
export type PickedDocument = { uri: string; name: string; type: string };

/** A PDF or a picture of the paper, or why not; null when the picker was closed. */
export async function pickDocument(): Promise<{ document: PickedDocument } | { problem: 'fileType' | 'fileTooLarge' } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_TYPES, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const type = fileType({ name: asset.name, type: asset.mimeType ?? '' });
  if (!DOCUMENT_TYPES.includes(type)) return { problem: 'fileType' };
  if ((asset.size ?? 0) > MAX_DOCUMENT_BYTES) return { problem: 'fileTooLarge' };
  return { document: { uri: asset.uri, name: asset.name, type } };
}

export class DocumentRefused extends Error {
  constructor(readonly reason: 'fileType' | 'fileTooLarge' | 'failed') {
    super(reason);
    this.name = 'DocumentRefused';
  }
}

/**
 * A verification paper: the bytes to `company-documents/<company>/<type>-<uuid>.<ext>`
 * (a company admin's folder, fewer than twenty files), then the website's
 * recordCompanyDocument, which reads what arrived and records it for review.
 * Refused, the upload is taken back out.
 */
export function useUploadDocument(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ docType, document }: { docType: DocType; document: PickedDocument }) => {
      const bytes = await new File(document.uri).arrayBuffer();
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new DocumentRefused('fileTooLarge');
      const path = `${companyId}/${docType}-${uuid()}.${fileExtension({ name: document.name, type: document.type }, 'pdf')}`;
      const storage = supabase.storage.from(COMPANY_DOCS_BUCKET);
      const { error } = await storage.upload(path, bytes, { upsert: false, contentType: document.type });
      if (error) throw new DocumentRefused('failed');

      const result = await callAction('recordCompanyDocument', { companyId, docType, storagePath: path }).catch(() => null);
      if (!result?.ok) {
        await storage.remove([path]).catch(() => {});
        throw new DocumentRefused(result && !result.ok && result.error === 'file_type' ? 'fileType' : 'failed');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employer', 'company'] });
      // The company moves to "pending" once a paper is in.
      queryClient.invalidateQueries({ queryKey: ['viewer'] });
    },
  });
}

/** The team refusals the website has words for; anything else is the generic line. */
export type MemberRefusal = 'no_account' | 'already_member' | 'not_employer' | 'rate_limited' | 'failed';

export class MemberRefused extends Error {
  constructor(readonly reason: MemberRefusal) {
    super(reason);
    this.name = 'MemberRefused';
  }
}

/**
 * Add a colleague who already has an account. Both of the action's limits
 * (the daily look-up count and the hourly additions) are "too many, wait":
 * the website's form named only one of them.
 */
export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: CompanyMemberRole }) => {
      const result = await callAction('addCompanyMember', input);
      if (!result.ok) {
        const reason: MemberRefusal =
          result.error === 'rate_limit' || result.error === 'rate_limited'
            ? 'rate_limited'
            : result.error === 'no_account' || result.error === 'already_member' || result.error === 'not_employer'
              ? result.error
              : 'failed';
        throw new MemberRefused(reason);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employer', 'company'] }),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const result = await callAction('removeCompanyMember', { userId });
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employer', 'company'] }),
  });
}

/** This month, as the grants table keys it: the first day, in UTC. */
function thisMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * The company's orders (the latest twenty) and whether this month's free post
 * has been taken — both a company admin's to read; anybody else sees none.
 */
export function useBilling() {
  const company = useCompany();
  return useQuery({
    queryKey: ['employer', 'billing', company?.id ?? null],
    enabled: Boolean(company),
    queryFn: async () => {
      const id = company?.id as string;
      const [orders, grant] = await Promise.all([
        supabase.from('orders').select('*').eq('company_id', id).order('created_at', { ascending: false }).limit(20),
        supabase.from('monthly_free_post_grants').select('period').eq('company_id', id).eq('period', thisMonth()).maybeSingle(),
      ]);
      if (orders.error) throw orders.error;
      return { orders: (orders.data ?? []) as OrderRow[], claimedThisMonth: Boolean(grant.data) };
    },
  });
}

/**
 * This month's free post, for a verified company. The answer is the
 * database's: false when the company is not verified or the month is taken —
 * a successful call is not a granted post.
 */
export function useClaimFreePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await callAction('claimMonthlyFreePost');
      return Boolean(result.ok && result.data?.claimed);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['employer'] });
      queryClient.invalidateQueries({ queryKey: ['viewer'] });
    },
  });
}
