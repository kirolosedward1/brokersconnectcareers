import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import type { JobStatus } from '@/lib/supabase/database.types';
import { Button } from '~/components/ui/button';
import { SendForward } from '~/components/ui/icons';
import { Archive, RotateCcw } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { TransitionRefused, useTransitionJob } from '~/features/employer/listings';
import { ApiError } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

const REFUSAL_COPY = {
  post_cap: 'postCapBlocked',
  invalid_transition: 'listingMoved',
  standing: 'standingBlocked',
  company_suspended: 'companySuspendedBlocked',
} as const;

/**
 * Only the moves an employer may make, by the status the page shows: close a
 * live listing, submit a draft or a rejected one, reopen one that ended —
 * which goes back through review and starts thirty days afresh, as the hint
 * beside it says.
 */
export function StatusActions({ jobId, status, title }: { jobId: string; status: JobStatus; title: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const move = useTransitionJob();
  const [error, setError] = useState<string | null>(null);

  const go = (next: 'pending_review' | 'closed') => {
    setError(null);
    move.mutate(
      { jobId, status: next },
      {
        onError: (failure) => {
          if (failure instanceof ApiError && failure.status === 0) return setError(t('app.offline.body'));
          const reason = failure instanceof TransitionRefused ? failure.reason : 'failed';
          // The company keeps this member from posting (migration 376).
          if (reason === 'not_permitted') return setError(t('app.team.notPermittedPost'));
          setError(reason === 'failed' ? t('common.errorBody') : t(`employer.${REFUSAL_COPY[reason]}`));
        },
      },
    );
  };

  let action: React.ReactNode = null;
  if (status === 'active') {
    action = (
      <Button
        label={t('employer.closeJob')}
        accessibilityLabel={`${t('employer.closeJob')}: ${title}`}
        variant="ghost"
        size="sm"
        icon={<Archive size={16} color={colors.destructive} />}
        loading={move.isPending}
        onPress={() => go('closed')}
      />
    );
  } else if (status === 'draft' || status === 'rejected') {
    action = (
      <Button
        label={t('employer.submitForReview')}
        accessibilityLabel={`${t('employer.submitForReview')}: ${title}`}
        variant="secondary"
        size="sm"
        icon={<SendForward size={16} color={colors.primary} />}
        loading={move.isPending}
        onPress={() => go('pending_review')}
      />
    );
  } else if (status === 'expired' || status === 'closed') {
    action = (
      <View style={{ gap: space[1], alignItems: 'flex-start' }}>
        <Button
          label={t('employer.reopenJob')}
          accessibilityLabel={`${t('employer.reopenJob')}: ${title}`}
          variant="secondary"
          size="sm"
          icon={<RotateCcw size={16} color={colors.success} />}
          loading={move.isPending}
          onPress={() => go('pending_review')}
        />
        <Text variant="caption" tone="mutedForeground">
          {t('employer.reopenHint')}
        </Text>
      </View>
    );
  }
  if (!action) return null;

  return (
    <View style={{ gap: space[1], alignItems: 'flex-start' }}>
      {action}
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
