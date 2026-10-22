import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { AdminUserSearchRow } from '@/lib/supabase/database.types';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, openOnWebsite } from '~/components/admin/kit';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Ban, Check, ExternalLink, RotateCcw, UserCheck } from '~/components/ui/lucide';
import { Segmented } from '~/components/ui/segmented';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAccounts } from '~/features/admin/queries';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

type Standing = 'pending' | 'rejected';

/**
 * Accounts waiting for approval, and the suspended — the website's
 * /admin/users, by standing. Approving lets the account act and emails its
 * owner; suspending needs a reason, which the owner is sent, and takes an
 * employer's live listings down with it when nobody approved is left on the
 * company. An admin account has no lever here (set_account_approval refuses
 * one). No phone or email is shown: those come one at a time, on the record,
 * from the account's file on the website.
 */
export default function AdminAccountsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.users') }} />
      <AdminGate>
        <Accounts />
      </AdminGate>
    </>
  );
}

function Accounts() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ status?: string }>();
  const [view, setView] = useState<Standing>(params.status === 'rejected' ? 'rejected' : 'pending');
  const accounts = useAccounts(view);
  const pull = usePullRefresh(() => accounts.refetch());
  const list = useTabList<FlashListRef<AdminUserSearchRow>>();

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Segmented
        label={t('admin.colStatus')}
        options={[
          { value: 'pending', label: t('admin.approval.pending') },
          { value: 'rejected', label: t('admin.approval.rejected') },
        ]}
        value={view}
        onChange={setView}
      />
      {accounts.data && accounts.data.rows.length < accounts.data.total ? (
        <Text variant="small" tone="mutedForeground">
          {t.markup('app.admin.showing', { shown: accounts.data.rows.length, total: accounts.data.total, ...markupTags })}
        </Text>
      ) : null}
    </View>
  );

  let body: React.ReactNode = null;
  if (accounts.isPending) body = <LoadingState />;
  else if (accounts.isError && !accounts.data) body = <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />;

  return (
    <FlashList
      {...list}
      data={body ? [] : (accounts.data?.rows ?? [])}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <AccountRow key={item.id} account={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={header}
      ListEmptyComponent={body ?? <EmptyState icon={UserCheck} title={t('admin.emptyQueue')} />}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

function AccountRow({ account }: { account: AdminUserSearchRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const employer = account.role === 'employer';
  const role =
    account.role === 'employer' ? t('onboarding.roleEmployer') : account.role === 'admin' ? t('admin.title') : t('onboarding.roleCandidate');
  const lever = (status: 'approved' | 'rejected') => {
    if (status === 'approved') {
      const label = account.approval_status === 'rejected' ? t('admin.restoreAccount') : t('admin.approveAccount');
      openDecision({
        lever: { do: 'approval', userId: account.id, status },
        title: `${label} — ${account.full_name}`,
        body: t('admin.approveAccountBody'),
        confirmLabel: label,
        reason: 'none',
      });
    } else {
      openDecision({
        lever: { do: 'approval', userId: account.id, status },
        title: `${t('admin.suspendAccount')} — ${account.full_name}`,
        body: employer ? t('admin.suspendTakesListingsDown') : t('admin.suspendCandidateBody'),
        confirmLabel: t('admin.suspendAccount'),
        destructive: true,
        reason: 'required',
        reasonLabel: t('admin.reasonToUser'),
      });
    }
  };

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Avatar name={account.full_name} src={account.avatar_url} seed={account.id} size="md" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold">{account.full_name}</Text>
          <Text variant="small" tone="mutedForeground">
            {account.company_id ? `${role} · ${localized(locale, account.company_name_ar ?? '', account.company_name_en)}` : role}
          </Text>
          <Text variant="caption" tone="mutedForeground">
            {`${t('admin.colJoined')}: ${formatDate(account.created_at, locale)}`}
          </Text>
        </View>
        <Badge
          variant={account.approval_status === 'rejected' ? 'destructive' : account.approval_status === 'pending' ? 'warning' : 'success'}
          label={t(`admin.approval.${account.approval_status}`)}
        />
      </View>
      {account.approval_note ? (
        <Text variant="small" tone="mutedForeground">{`«${account.approval_note}»`}</Text>
      ) : null}

      {account.role === 'admin' ? (
        <Text variant="small" tone="mutedForeground">
          {t('admin.adminNoLever')}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {account.approval_status !== 'approved' ? (
            <Button
              label={account.approval_status === 'rejected' ? t('admin.restoreAccount') : t('admin.approveAccount')}
              accessibilityLabel={`${account.approval_status === 'rejected' ? t('admin.restoreAccount') : t('admin.approveAccount')}: ${account.full_name}`}
              size="sm"
              icon={
                account.approval_status === 'rejected' ? (
                  <RotateCcw size={16} color={colors.primaryForeground} />
                ) : (
                  <Check size={16} color={colors.primaryForeground} />
                )
              }
              onPress={() => lever('approved')}
            />
          ) : null}
          {account.approval_status !== 'rejected' ? (
            <Button
              label={t('admin.suspendAccount')}
              accessibilityLabel={`${t('admin.suspendAccount')}: ${account.full_name}`}
              variant="ghost"
              size="sm"
              icon={<Ban size={16} color={colors.destructive} />}
              onPress={() => lever('rejected')}
            />
          ) : null}
          <Button
            label={t('app.admin.onWebsite')}
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={16} color={colors.foreground} />}
            onPress={() => openOnWebsite(`/admin/users/${account.id}`)}
          />
        </View>
      )}
    </Card>
  );
}
