import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import { localized } from '@/lib/locale';
import { canAccessEmployerArea } from '@/lib/permissions';
import { SignedOut } from '~/components/navigation/signed-out';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Compass, ShieldCheck } from '~/components/ui/lucide';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useCompanyPage } from '~/features/employer/company';
import { useApprovalRequests, useDecideRequest, type ApprovalRequest } from '~/features/employer/rules';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * What waits for an admin (Phase B 05): declines and live listings' pay
 * changes a colleague asked for, approved (made now, as the admin) or
 * refused. Anybody else on the team sees their own asks and what became of
 * them; the database decides which rows each reads.
 */
export default function ApprovalsScreen() {
  const t = useTranslations();
  const { session, viewer, actor } = useSession();
  let body: ReactNode;
  if (!session) body = <SignedOut next="/employer/approvals" />;
  else if (!viewer?.profile) body = <ViewerPending />;
  else if (!canAccessEmployerArea(actor) || !viewer.company) body = <EmptyState icon={Compass} title={t('common.notFound')} body={t('common.notFoundBody')} />;
  else body = <Queue />;
  return (
    <>
      <Stack.Screen options={{ title: t('app.rules.queueTitle') }} />
      {body}
    </>
  );
}

function Queue() {
  const t = useTranslations();
  const { colors } = useTheme();
  const requests = useApprovalRequests();
  const isAdmin = useCompanyPage().data?.isAdmin ?? false;
  const pull = usePullRefresh(() => requests.refetch());
  if (requests.isPending) return <LoadingState />;
  if (requests.isError && !requests.data) return <ErrorState error={requests.error} onRetry={() => requests.refetch()} />;
  const pending = requests.data.filter((row) => row.status === 'pending');
  const decided = requests.data.filter((row) => row.status !== 'pending');
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}
    >
      <Text variant="small" tone="mutedForeground">
        {isAdmin ? t('app.rules.queueLedeAdmin') : t('app.rules.queueLedeOwn')}
      </Text>
      {pending.length === 0 && decided.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t('app.rules.queueEmpty')} />
      ) : null}
      {pending.map((request) => (
        <RequestCard key={request.id} request={request} canDecide={isAdmin} />
      ))}
      {decided.length ? (
        <Text variant="small" weight="semibold" tone="mutedForeground" accessibilityRole="header">
          {t('app.rules.queueDecided')}
        </Text>
      ) : null}
      {decided.map((request) => (
        <RequestCard key={request.id} request={request} canDecide={false} />
      ))}
    </ScrollView>
  );
}

const STATUS_BADGE = { pending: 'warning', approved: 'success', refused: 'destructive', expired: 'outline' } as const;

/** One ask: what it is, about whom, when, and — for an admin while it waits — the two answers. */
export function RequestCard({ request, canDecide }: { request: ApprovalRequest; canDecide: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const decide = useDecideRequest();
  const [error, setError] = useState<string | null>(null);
  const job = request.jobTitleAr ? localized(locale, request.jobTitleAr, request.jobTitleEn) : null;
  const about = request.kind === 'decline' ? [request.candidateName, job].filter(Boolean).join(' · ') : job;
  const answer = (approve: boolean) => {
    setError(null);
    decide.mutate(
      { id: request.id, approve },
      {
        onSuccess: (outcome) => {
          if (outcome === 'expired') setError(t('app.rules.expired'));
        },
        onError: () => setError(t('common.errorBody')),
      },
    );
  };
  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
        <Text weight="semibold" style={{ flexShrink: 1 }}>
          {request.kind === 'decline' ? t('app.rules.kindDecline') : t('app.rules.kindPay')}
        </Text>
        <Badge variant={STATUS_BADGE[request.status]} label={t(`app.rules.status_${request.status}`)} />
      </View>
      {about ? (
        <Text variant="small" tone="mutedForeground">
          {about}
        </Text>
      ) : null}
      <Text variant="caption" tone="mutedForeground">
        {formatDateTime(request.created_at, locale)}
      </Text>
      {canDecide && request.status === 'pending' ? (
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button label={t('app.rules.approve')} size="sm" loading={decide.isPending && decide.variables?.approve === true} onPress={() => answer(true)} />
          <Button label={t('app.rules.refuse')} size="sm" variant="outline" loading={decide.isPending && decide.variables?.approve === false} onPress={() => answer(false)} />
        </View>
      ) : null}
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
