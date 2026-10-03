import { Pressable } from 'react-native';
import { useTranslations } from 'use-intl';
import { UserRoundCheck, UserRoundPlus } from '~/components/ui/lucide';
import { Button } from '~/components/ui/button';
import { useShortlistedIds, useToggleShortlist } from '~/features/directory/queries';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';

/**
 * Keeping a consultant on the company's shortlist — the website's
 * ShortlistToggle and ShortlistButton. A person with a plus and a person with
 * a tick, never the bookmark: the board already spends that on listings.
 * Offered only where it can work (a company to keep them in, an open card);
 * the caller decides that, from canShortlistAgents and the card.
 */
export function useShortlistToggle(agentId: string) {
  const t = useTranslations('agents');
  const shortlisted = useShortlistedIds().data;
  const saved = (shortlisted ?? []).includes(agentId);
  // Until the shortlist is read, a press could take somebody off (the website toggles).
  const known = shortlisted !== undefined;
  const toggle = useToggleShortlist();
  return {
    saved,
    pending: toggle.isPending || !known,
    label: saved ? t('shortlistRemove') : t('shortlistAdd'),
    toggle: () => {
      if (known) toggle.mutate({ agentId, saved });
    },
  };
}

/** The directory card's icon: a second action on a card whose first is "open this". */
export function ShortlistIcon({ shortlist }: { shortlist: ReturnType<typeof useShortlistToggle> }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shortlist.label}
      accessibilityState={{ selected: shortlist.saved, busy: shortlist.pending }}
      disabled={shortlist.pending}
      onPress={shortlist.toggle}
      hitSlop={4}
      style={{
        width: hitTarget,
        height: hitTarget,
        marginTop: -space[3],
        marginEnd: -space[3],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {shortlist.saved ? (
        <UserRoundCheck size={20} color={colors.primary} />
      ) : (
        <UserRoundPlus size={20} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

/** The profile's labelled button, beside the contact and the CV. */
export function ShortlistButton({ agentId }: { agentId: string }) {
  const { colors } = useTheme();
  const shortlist = useShortlistToggle(agentId);
  return (
    <Button
      label={shortlist.label}
      variant={shortlist.saved ? 'secondary' : 'outline'}
      size="lg"
      disabled={shortlist.pending}
      accessibilityState={{ selected: shortlist.saved, busy: shortlist.pending, disabled: shortlist.pending }}
      icon={
        shortlist.saved ? (
          <UserRoundCheck size={18} color={colors.primary} />
        ) : (
          <UserRoundPlus size={18} color={colors.foreground} />
        )
      }
      onPress={shortlist.toggle}
    />
  );
}
