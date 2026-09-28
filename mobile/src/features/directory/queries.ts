import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { serializeAgentFilters, type AgentFilters } from '@/lib/agent-filters';
import type { AgentDirectoryResponse } from '@/lib/mobile-api/reads';
import { canBrowseAgentDirectory, canShortlistAgents } from '@/lib/permissions';
import type {
  AgentCardDetail,
  AgentCardRow,
  AgentProfileRow,
  SavedAgentCardRow,
} from '@/lib/supabase/database.types';
import type { CvSections } from '~/features/profile/queries';
import { callAction, getJson } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The consultant directory — the website's /agents, /agents/<slug> and
 * /employer/talent — for the companies it exists for: an approved employer or
 * an admin (canBrowseAgentDirectory, which restates migration 322). The search
 * is the website's own query through /api/mobile/v1/agents; a card and its CV
 * are read here under the reader's session, as the profile page reads them, so
 * the database decides on every read what each card may show this company.
 *
 * Contact details are never part of a card: they are asked for, one press at a
 * time, through the website's revealAgentContact, which counts and limits.
 */

/** The website's AGENTS_PER_PAGE: the endpoint answers in pages of this size. */
export const AGENTS_PAGE_SIZE = 24;

/** A slug, or the id a locked card is opened by — getAgentCard()'s rule on the website. */
const HANDLE = /^(?:[a-z0-9][a-z0-9-]{0,118}|[0-9a-f-]{36})$/;

export function isAgentHandle(handle: string): boolean {
  return HANDLE.test(handle);
}

/** The directory's address for these filters and this page, as the website writes it. */
export function directorySearch(filters: AgentFilters, page = 1): string {
  return serializeAgentFilters({ ...filters, page }).toString();
}

/**
 * The directory, page after page. What a card shows depends on the reader's
 * company — anonymous until it is verified — so the cache is kept per company
 * and per verification: the day the papers are accepted, the names appear.
 */
export function useAgentDirectory(filters: AgentFilters) {
  const { actor } = useSession();
  return useInfiniteQuery({
    queryKey: [
      'directory',
      'search',
      actor?.userId ?? null,
      actor?.company?.verification_status ?? null,
      directorySearch({ ...filters, page: 1 }),
    ],
    enabled: canBrowseAgentDirectory(actor),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const search = directorySearch(filters, pageParam);
      return getJson<AgentDirectoryResponse>(`/api/mobile/v1/agents${search ? `?${search}` : ''}`, { signedIn: true });
    },
    // The server answers the last page when asked past it, so this stops there.
    getNextPageParam: (last) => (last.page < last.pageCount ? last.page + 1 : undefined),
  });
}

/**
 * How many consultants a set of filters comes to, asked of the same endpoint
 * while the reader chooses — what the sheet's button says before it is pressed.
 */
export function useDirectoryTotal(search: string, enabled: boolean) {
  const { actor } = useSession();
  return useQuery({
    queryKey: ['directory', 'total', actor?.userId ?? null, search],
    queryFn: async () =>
      (await getJson<AgentDirectoryResponse>(`/api/mobile/v1/agents${search ? `?${search}` : ''}`, { signedIn: true })).total,
    enabled: enabled && canBrowseAgentDirectory(actor),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Every consultant across the pages loaded so far, each once. */
export function flattenAgents(pages: AgentDirectoryResponse[] | undefined): AgentCardRow[] {
  const seen = new Set<string>();
  const agents: AgentCardRow[] = [];
  for (const page of pages ?? []) {
    for (const agent of page.agents) {
      if (seen.has(agent.id)) continue;
      seen.add(agent.id);
      agents.push(agent);
    }
  }
  return agents;
}

// ---------------------------------------------------------------------------
// The shortlist: which consultants the company keeps
// ---------------------------------------------------------------------------

/**
 * The company the reader keeps consultants for — `my_company_id()`, which is
 * what the viewer's company is — or null when they cannot keep any.
 */
function useShortlistCompany(): string | null {
  const { actor } = useSession();
  return canShortlistAgents(actor) ? (actor?.company?.id ?? null) : null;
}

/**
 * The ids the company keeps — at most two hundred, the database's cap — read
 * once for the whole app. Scoped to the one company explicitly, as the website
 * does: a colleague in two brokerages may read both lists, and would otherwise
 * see a consultant marked as kept because the other one kept them.
 */
export function useShortlistedIds() {
  const companyId = useShortlistCompany();
  return useQuery({
    queryKey: ['directory', 'shortlisted', companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_agents')
        .select('agent_id')
        .eq('company_id', companyId as string);
      if (error) throw error;
      return ((data ?? []) as { agent_id: string }[]).map((row) => row.agent_id);
    },
  });
}

/**
 * Keep a consultant, or let them go — the website's toggleSavedAgent, shown
 * at once. A refusal (the list is full, or the card is no longer open to the
 * company) puts the control back without a word, as the website does: the
 * second is a fact about the consultant's own settings.
 */
export function useToggleShortlist() {
  const queryClient = useQueryClient();
  const companyId = useShortlistCompany();
  const key = ['directory', 'shortlisted', companyId];

  return useMutation({
    mutationFn: async (agentId: string) => {
      const result = await callAction('toggleSavedAgent', { agentId });
      if (!result.ok) throw new Error(result.error);
      return { agentId, saved: Boolean(result.data?.saved) };
    },
    onMutate: async (agentId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData<string[]>(key, (ids = []) =>
        ids.includes(agentId) ? ids.filter((id) => id !== agentId) : [...ids, agentId],
      );
      return { before };
    },
    onError: (_error, _agentId, context) => {
      queryClient.setQueryData(key, context?.before);
    },
    // The server's answer is the state: a colleague may have pressed first.
    onSuccess: ({ agentId, saved }) => {
      queryClient.setQueryData<string[]>(key, (ids = []) =>
        saved ? (ids.includes(agentId) ? ids : [...ids, agentId]) : ids.filter((id) => id !== agentId),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['directory', 'shortlist'] }),
  });
}

/** The website's SAVED_AGENTS_PER_PAGE. */
export const SHORTLIST_PAGE_SIZE = 24;

/**
 * The shortlist itself, through saved_agent_cards(), which re-derives on every
 * read what of each consultant may still be shown — a consultant who has since
 * hidden their profile comes back as a row with nothing but the fact of it.
 */
export function useShortlist() {
  const companyId = useShortlistCompany();
  return useInfiniteQuery({
    queryKey: ['directory', 'shortlist', companyId],
    enabled: Boolean(companyId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('saved_agent_cards', {
        p_limit: SHORTLIST_PAGE_SIZE,
        p_offset: pageParam,
      });
      if (error) throw error;
      return (data ?? []) as SavedAgentCardRow[];
    },
    getNextPageParam: (last, pages) =>
      last.length === SHORTLIST_PAGE_SIZE ? pages.length * SHORTLIST_PAGE_SIZE : undefined,
  });
}

/** Every row across the pages loaded so far, each once. */
export function flattenShortlist(pages: SavedAgentCardRow[][] | undefined): SavedAgentCardRow[] {
  const seen = new Set<string>();
  const rows: SavedAgentCardRow[] = [];
  for (const page of pages ?? []) {
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// One consultant
// ---------------------------------------------------------------------------

/** What the profile page reads beside the card: the owner, the setting, the summary and the record. */
export type AgentAbout = Pick<
  AgentProfileRow,
  'summary_ar' | 'summary_en' | 'units_closed' | 'volume_egp' | 'user_id' | 'visibility'
>;

export type AgentPage = { card: AgentCardDetail; about: AgentAbout | null; cv: CvSections };

/**
 * One consultant's page: get_agent_card() — which answers the directory's
 * readers and the consultant themselves, and nobody else — then the CV and the
 * profile's own columns, read under the reader's session, so row-level
 * security drops whatever this company may not see (an empty section, not an
 * error). Null: no card for this reader.
 */
export function useAgentPage(handle: string) {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['directory', 'card', userId, handle],
    enabled: Boolean(userId),
    queryFn: async (): Promise<AgentPage | null> => {
      if (!isAgentHandle(handle)) return null;
      const { data, error } = await supabase.rpc('get_agent_card', { p_handle: handle });
      if (error) throw error;
      const card = ((data ?? []) as AgentCardDetail[])[0] ?? null;
      if (!card) return null;

      const [experience, education, certifications, about] = await Promise.all([
        supabase.from('agent_experience').select('*').eq('agent_id', card.id).order('started', { ascending: false }),
        supabase.from('agent_education').select('*').eq('agent_id', card.id).order('graduated', { ascending: false }),
        supabase.from('agent_certifications').select('*').eq('agent_id', card.id).order('issued', { ascending: false }),
        supabase
          .from('agent_profiles')
          .select('summary_ar, summary_en, units_closed, volume_egp, user_id, visibility')
          .eq('id', card.id)
          .maybeSingle(),
      ]);
      const failed = experience.error ?? education.error ?? certifications.error ?? about.error;
      if (failed) throw failed;

      return {
        card,
        about: (about.data as AgentAbout | null) ?? null,
        cv: {
          experience: (experience.data ?? []) as CvSections['experience'],
          education: (education.data ?? []) as CvSections['education'],
          certifications: (certifications.data ?? []) as CvSections['certifications'],
        },
      };
    },
  });
}

/**
 * That a company looked — the website's recordAgentView, for anybody with a
 * company; record_agent_view() decides whether it counts (never the owner's
 * own look, once a day per company) and refuses in silence. Nothing waits on
 * it, and a failure is nobody's to hear about.
 */
export function recordAgentView(slug: string): void {
  callAction('recordAgentView', { slug }).catch(() => {});
}

export type RevealedContact = { fullName: string; phone: string; whatsappUrl: string; hasCv: boolean };

/** Why a number was not handed over, in the website's words for each. */
export class RevealRefused extends Error {
  constructor(
    readonly reason: 'rate_limit' | 'locked' | 'failed',
    readonly retryAfterSeconds?: number,
  ) {
    super(reason);
    this.name = 'RevealRefused';
  }
}

/**
 * Ask for a consultant's number: one press, one recorded reveal, the answer a
 * WhatsApp link with the opener already written — reveal_agent_contact() on
 * the other side decides and counts.
 */
export function useRevealContact() {
  return useMutation({
    mutationFn: async ({ handle, locale }: { handle: string; locale: 'ar' | 'en' }): Promise<RevealedContact> => {
      const result = await callAction('revealAgentContact', { handle, locale });
      if (result.ok) return result.data;
      if (result.error === 'rate_limit') throw new RevealRefused('rate_limit', result.retryAfterSeconds);
      if (result.error === 'locked' || result.error === 'forbidden') throw new RevealRefused('locked');
      throw new RevealRefused('failed');
    },
  });
}

/**
 * A consultant's CV — for a company once the contact is revealed, or for the
 * consultant themselves — through the website's /api/agent-cv, which mints a
 * five-minute address for whoever may have it; the in-app browser shows it.
 */
export async function openAgentCv(handle: string): Promise<void> {
  const { url } = await getJson<{ url: string }>(`/api/agent-cv/${encodeURIComponent(handle)}`, { signedIn: true });
  await WebBrowser.openBrowserAsync(url);
}
