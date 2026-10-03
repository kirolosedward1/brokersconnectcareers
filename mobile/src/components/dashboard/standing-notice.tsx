import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Ban, CirclePause, CircleSlash, Clock } from '~/components/ui/lucide';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
import { AppealPanel } from '~/components/moderation/appeal-panel';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { useAccountNote } from '~/features/dashboard/candidate';
import { useCompanySuspension } from '~/features/employer/overview';
import { useAppealState } from '~/features/moderation/appeals';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * Where an account stands, said to its holder at the top of their Home — the
 * website's StandingNotice. Somebody on the wrong end of a decision needs
 * three things, in this order: what happened, the reason a moderator gave,
 * and what they can do about it (the appeal panel, offered only where the
 * database says an appeal is possible). Never how the decision was reached.
 *
 * A candidate whose account is pending is on hold: only a moderator puts a
 * candidate there. For an employer, pending is also a new company's first
 * review, and only an appeal state tells a hold apart. A suspended company
 * is said separately, with its own reason and its own appeal.
 */
export function StandingNotice({ profile, company = null }: { profile: ProfileRow; company?: CompanyRow | null }) {
  const t = useTranslations();
  const { colors } = useTheme();

  const status = profile.approval_status;
  const employer = profile.role === 'employer';
  const standing = status !== 'approved';
  const companySuspended = employer && Boolean(company?.suspended_at);

  const note = useAccountNote(standing).data ?? null;
  const account = useAppealState('account', standing ? profile.id : null).data ?? null;
  const companyReason = useCompanySuspension(company?.id ?? null, companySuspended).data ?? null;

  // A hold is a moderator's decision; a new employer's first review is not.
  const held = status === 'pending' && (!employer || Boolean(account?.appealable || account?.open || account?.last));
  const firstReview = status === 'pending' && employer && !held;

  const panels: React.ReactNode[] = [];

  if (status === 'rejected' || held) {
    const suspended = status === 'rejected';
    panels.push(
      <Notice
        key="account"
        tone={suspended ? 'destructive' : 'warning'}
        title={suspended ? t('standing.suspendedTitle') : t('standing.heldTitle')}
        icon={
          suspended ? <CircleSlash size={16} color={colors.destructive} /> : <CirclePause size={16} color={colors.warning} />
        }
      >
        <View>
          <Text variant="small">
            {suspended
              ? employer
                ? t('standing.suspendedBodyEmployer')
                : t('standing.suspendedBodyCandidate')
              : employer
                ? t('standing.heldBodyEmployer')
                : t('standing.heldBodyCandidate')}
          </Text>
          {note ? <Text variant="small">{t('standing.reason', { reason: note })}</Text> : null}
          <AppealPanel subjectType="account" subjectId={profile.id} />
        </View>
      </Notice>,
    );
  } else if (firstReview) {
    // Said once, at the top, where the work is — rather than discovered when the listing form refuses.
    panels.push(
      <Notice key="account" tone="warning" title={t('employer.pendingTitle')} icon={<Clock size={16} color={colors.warning} />}>
        <View style={{ gap: space[3] }}>
          <Text variant="small">{t('employer.pendingBody')}</Text>
          <View style={{ alignItems: 'flex-start' }}>
            <Button label={t('employer.company')} variant="outline" size="sm" onPress={() => router.navigate('/employer/company')} />
          </View>
        </View>
      </Notice>,
    );
  }

  if (companySuspended && company) {
    panels.push(
      <Notice
        key="company"
        tone="destructive"
        title={t('standing.companySuspendedTitle')}
        icon={<Ban size={16} color={colors.destructive} />}
      >
        <View>
          <Text variant="small">{t('standing.companySuspendedBody')}</Text>
          {companyReason ? <Text variant="small">{t('standing.reason', { reason: companyReason })}</Text> : null}
          <AppealPanel subjectType="company" subjectId={company.id} />
        </View>
      </Notice>,
    );
  }

  if (!panels.length) return null;
  return <View style={{ gap: space[3] }}>{panels}</View>;
}
