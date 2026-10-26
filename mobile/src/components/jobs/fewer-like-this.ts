import { useTranslations } from 'use-intl';
import type { JobListItem } from '@/lib/job-list';
import { canAccessCandidateArea } from '@/lib/permissions';
import { toast } from '~/components/feedback/toast';
import type { MenuItem } from '~/components/ui/action-menu';
import { RotateCcw, ThumbsDown } from '~/components/ui/lucide';
import { fewerKey, showAsUsual, showFewer, useFewerKeys } from '~/features/jobs/fewer';
import { useListOwner } from '~/features/jobs/recent';
import { useSession } from '~/lib/session';

/**
 * A held card's "Show fewer like this" (features/jobs/fewer.ts): this
 * listing's track in its district, set aside for this person, with Undo —
 * or, set aside already, the way back. Offered to a candidate only: theirs
 * is the Home that suggests roles, and to anybody else it would change
 * nothing they can see.
 */
export function useFewerLikeThis(job: Pick<JobListItem, 'track' | 'district_id' | 'district'>): MenuItem | null {
  const t = useTranslations('app');
  const { actor } = useSession();
  const owner = useListOwner();
  const keys = useFewerKeys(owner);
  if (!canAccessCandidateArea(actor)) return null;

  const key = fewerKey(job);
  if (keys.has(key)) {
    return {
      label: t('jobMenu.fewerOff'),
      icon: RotateCcw,
      onPress: () => {
        showAsUsual(owner, key);
        toast.show({ message: t('toast.fewerOff'), icon: RotateCcw });
      },
    };
  }
  return {
    label: t('jobMenu.fewer'),
    icon: ThumbsDown,
    onPress: () => {
      showFewer(owner, job);
      toast.show({
        message: t('toast.fewer'),
        icon: ThumbsDown,
        action: { label: t('toast.undo'), onPress: () => showAsUsual(owner, key) },
      });
    },
  };
}
