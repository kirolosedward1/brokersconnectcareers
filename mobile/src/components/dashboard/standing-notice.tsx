import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { CirclePause, CircleSlash } from 'lucide-react-native';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { AppealPanel } from '~/components/moderation/appeal-panel';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { useAccountNote } from '~/features/dashboard/candidate';
import { useAppealState } from '~/features/moderation/appeals';
import { useTheme } from '~/theme/provider';

/**
 * Where an account stands, said to its holder at the top of their Home — the
 * website's StandingNotice. Somebody on the wrong end of a decision needs
 * three things, in this order: what happened, the reason a moderator gave,
 * and what they can do about it (the appeal panel, offered only where the
 * database says an appeal is possible). Never how the decision was reached.
 *
 * A candidate whose account is pending is on hold: only a moderator puts a
 * candidate there. For an employer, pending is also a new company's first
 * review, and only an appeal state tells a hold apart. (The company's own
 * suspension joins this with the employer's console.)
 */
export function StandingNotice({ profile }: { profile: ProfileRow }) {
  const t = useTranslations('standing');
  const { colors } = useTheme();

  const status = profile.approval_status;
  const employer = profile.role === 'employer';
  const standing = status !== 'approved';

  const note = useAccountNote(standing).data ?? null;
  const account = useAppealState('account', standing ? profile.id : null).data ?? null;

  const held = status === 'pending' && (!employer || Boolean(account?.appealable || account?.open || account?.last));
  if (status !== 'rejected' && !held) return null;

  const suspended = status === 'rejected';
  const body = suspended
    ? employer
      ? t('suspendedBodyEmployer')
      : t('suspendedBodyCandidate')
    : employer
      ? t('heldBodyEmployer')
      : t('heldBodyCandidate');

  return (
    <Notice
      tone={suspended ? 'destructive' : 'warning'}
      title={suspended ? t('suspendedTitle') : t('heldTitle')}
      icon={
        suspended ? <CircleSlash size={16} color={colors.destructive} /> : <CirclePause size={16} color={colors.warning} />
      }
    >
      <View>
        <Text variant="small">{body}</Text>
        {note ? <Text variant="small">{t('reason', { reason: note })}</Text> : null}
        <AppealPanel subjectType="account" subjectId={profile.id} />
      </View>
    </Notice>
  );
}
