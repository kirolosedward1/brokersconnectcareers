import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { Gift } from '~/components/ui/lucide';
import { formatDate, formatEgp, formatNumber } from '@/lib/format';
import { canAccessEmployerArea, isSuspended } from '@/lib/permissions';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Notice } from '~/components/ui/notice';
import { SignedOut } from '~/components/navigation/signed-out';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useMobileConfig } from '~/features/config';
import { useBilling, useClaimFreePost } from '~/features/employer/company';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

/**
 * The company's balance — the website's /employer/billing, read-only: the
 * posting credits, this month's free post for a verified company, and the
 * orders. Nothing is sold in the app: posting is free while billing is off,
 * and buying is not something the app offers.
 */
export default function BillingScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { session, viewer, actor } = useSession();
  const billing = useBilling();
  const claim = useClaimFreePost();
  const billingEnabled = useMobileConfig().data?.billingEnabled ?? false;
  const company = viewer?.company ?? null;
  const header = <Stack.Screen options={{ title: t('billing.title') }} />;
  // The credits and the verified badge are the account's (viewer.company), not
  // the orders' read: a pull reads both, or a balance spent or bought on the
  // website stayed as it was.
  const queryClient = useQueryClient();
  const pull = usePullRefresh(() => Promise.all([billing.refetch(), queryClient.invalidateQueries({ queryKey: ['viewer'] })]));

  let body: React.ReactNode;
  if (!session) body = <SignedOut next="/employer/billing" />;
  else if (!viewer?.profile) body = <ViewerPending />;
  else if (!canAccessEmployerArea(actor)) body = <EmptyState title={t('common.notFound')} body={t('common.notFoundBody')} />;
  else if (isSuspended(actor)) body = <EmptyState title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  else if (!company) body = <EmptyState title={t('employer.createCompanyFirst')} body={t('employer.createCompanyFirstBody')} />;
  else if (billing.isPending) body = <LoadingState />;
  else if (billing.isError && !billing.data) body = <ErrorState error={billing.error} onRetry={() => billing.refetch()} />;
  else {
    const claimed = billing.data.claimedThisMonth || claim.data === true;
    body = (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
      >
        <Text tone="mutedForeground">{t('billing.lede')}</Text>
        {billingEnabled ? null : (
          <Notice tone="success" title={t('billing.disabled')}>
            {t('billing.disabledBody')}
          </Notice>
        )}

        <Card style={{ gap: space[3] }}>
          <Text variant="small" weight="medium" tone="mutedForeground">
            {t('billing.credits')}
          </Text>
          <Text variant="display" weight="bold" tone="primary">
            {formatNumber(company.post_credits, locale)}
          </Text>
          {/* The monthly free post is a verified company's. */}
          {company.verification_status === 'verified' ? (
            claimed ? (
              <Text variant="small" tone="mutedForeground">
                {t('employer.freePostClaimed')}
              </Text>
            ) : (
              <View style={{ gap: space[2], alignItems: 'flex-start' }}>
                <Button
                  label={t('employer.freePostClaim')}
                  variant="secondary"
                  icon={<Gift size={16} color={colors.primary} />}
                  loading={claim.isPending}
                  onPress={() => claim.mutate()}
                />
                {claim.data === false || claim.isError ? (
                  <Text variant="small" tone="destructive" accessibilityRole="alert">
                    {t('employer.freePostRefused')}
                  </Text>
                ) : null}
              </View>
            )
          ) : null}
        </Card>

        {billing.data.orders.length ? (
          <View style={{ gap: space[3] }}>
            <Text weight="semibold" accessibilityRole="header">
              {t('billing.orders')}
            </Text>
            <View style={{ borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {billing.data.orders.map((order, index) => (
                <View
                  key={order.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space[3],
                    padding: space[4],
                    borderTopWidth: index ? 1 : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="small" weight="medium">
                      {t(`billing.packName.${order.pack_key}`)}
                    </Text>
                    <Text variant="caption" tone="mutedForeground">
                      {`${formatDate(order.created_at, locale)} · ${formatEgp(order.amount_egp, locale)} ${t('common.egp')}`}
                    </Text>
                  </View>
                  <Badge
                    variant={order.status === 'paid' ? 'success' : order.status === 'failed' ? 'destructive' : 'default'}
                    label={t(`billing.orderStatus.${order.status}`)}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}
