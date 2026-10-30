import type { AgentProfileInput } from '@/lib/mobile-api/contract';
import { useSession } from '~/lib/session';
import { useAgentProfile, useSaveAgentProfile } from './queries';

type CardPatch = Partial<Pick<AgentProfileInput, 'visibility' | 'availability' | 'tracks' | 'districtIds'>>;

/**
 * One or two of the directory card's answers changed on their own (who sees
 * it, whether the person is looking, the tracks and areas), from the
 * Privacy and Job-seeking screens. The website's action takes the whole
 * card, so everything else goes back exactly as it was read: the profile
 * form's own save, with the CV kept. Ready only once the card and its
 * developers are read; a list that could not be read is not taken for none.
 */
export function useSaveCardFields() {
  const { viewer } = useSession();
  const card = useAgentProfile();
  const save = useSaveAgentProfile();
  const agent = card.data?.agent ?? null;
  const developerIds = card.data?.developerIds ?? null;
  const profile = viewer?.profile ?? null;
  const ready = Boolean(agent && developerIds && profile);

  const saveFields = (patch: CardPatch, handlers?: { onSuccess?: () => void; onError?: (failure: unknown) => void }) => {
    if (!agent || !developerIds || !profile) return;
    save.mutate(
      {
        input: {
          fullName: profile.full_name,
          whatsapp: profile.whatsapp_phone ?? '',
          headlineAr: agent.headline_ar,
          headlineEn: agent.headline_en,
          yearsExperience: agent.years_experience ?? 0,
          tracks: agent.tracks ?? [],
          districtIds: agent.district_ids ?? [],
          developerIds,
          languages: agent.languages ?? ['ar'],
          availability: agent.availability,
          visibility: agent.visibility,
          ...patch,
        },
        cv: { kind: 'keep' },
      },
      handlers,
    );
  };

  return { card, agent, ready, saveFields, isPending: save.isPending };
}
