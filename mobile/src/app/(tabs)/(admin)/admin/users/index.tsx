import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { AdminUserSearchRow } from '@/lib/supabase/database.types';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, ApprovalBadge, useRoleLabel } from '~/components/admin/kit';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { ForwardChevron } from '~/components/ui/icons';
import { Check, RotateCcw, SearchX, UserCheck } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { SearchField } from '~/components/ui/search-field';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { ACCOUNTS_VIEWS, flattenAccounts, useAccountList, type AccountsView } from '~/features/admin/accounts';
import { useTabList } from '~/features/tab-bar';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * The accounts — the website's /admin/users: any account, found the way
 * support gets asked about it (a name fragment, or an exact email, phone or
 * id, through admin_search_users, which never carries a phone or an email
 * back), in the views the website has, the waiting accounts first. A row
 * opens the account's file, where its facts and every lever are; the queue's
 * own work — approving an account that waits, restoring one — is a tap from
 * the row too. No phone or email is shown: those come one at a time, on the
 * record, from the file.
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

/** The view a link asks for (the overview's "suspended" figure), the waiting accounts otherwise. */
function viewFor(status: string | undefined): AccountsView {
  return status === 'rejected' ? 'suspended' : 'pending';
}

function useViewLabels(): Record<AccountsView, string> {
  const t = useTranslations();
  return {
    pending: t('admin.approval.pending'),
    all: t('admin.filterAll'),
    candidates: t('onboarding.roleCandidate'),
    employers: t('onboarding.roleEmployer'),
    admins: t('admin.title'),
    suspended: t('admin.approval.rejected'),
    blocked: t('admin.signInBlocked'),
  };
}

function Accounts() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ status?: string }>();
  const [view, setView] = useState<AccountsView>(() => viewFor(params.status));
  const [query, setQuery] = useState('');
  const accounts = useAccountList(view, query);
  const nextPage = useNextPage(accounts);
  const pull = usePullRefresh(() => accounts.refetch());
  const list = useTabList<FlashListRef<AdminUserSearchRow>>();
  const rows = useMemo(() => flattenAccounts(accounts.data?.pages), [accounts.data]);
  const labels = useViewLabels();

  let body: ReactNode = null;
  if (accounts.isPending) body = <LoadingState />;
  else if (accounts.isError && !accounts.data) body = <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />;

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('app.admin.accountsLede')}
      </Text>
      {/* One view at a time: a radio group, as VoiceOver should say it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="radiogroup"
        accessibilityLabel={t('admin.colStatus')}
        contentContainerStyle={{ gap: space[2] }}
      >
        {ACCOUNTS_VIEWS.map((option) => (
          <Chip key={option} radio label={labels[option]} selected={option === view} onPress={() => setView(option)} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    // The search, over whatever is below it, so the words stay in view while their answer comes.
    <View style={{ flex: 1 }}>
      <SearchField
        value={query}
        label={t('filters.search')}
        placeholder={t('admin.usersSearchPlaceholder')}
        onSearch={setQuery}
        style={{ marginHorizontal: gutter, marginTop: space[2], marginBottom: space[1] }}
      />
      <FlashList
        {...list}
        data={body ? [] : rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <AccountRow key={item.id} account={item} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          body ??
          // A search that found nobody says so; a view with nobody in it is a queue that is clear.
          (query ? <EmptyState icon={SearchX} title={t('admin.searchNothing')} /> : <EmptyState icon={UserCheck} title={t('admin.emptyQueue')} />)
        }
        ListFooterComponent={<PageFooter query={accounts} />}
        onEndReached={nextPage}
        onEndReachedThreshold={0.5}
        {...pull}
      />
    </View>
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

function AccountRow({ account }: { account: AdminUserSearchRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const role = useRoleLabel()(account.role);
  const open = () => router.push({ pathname: '/admin/users/[id]', params: { id: account.id } });

  // The queue's one-tap work: approving an account that waits, or restoring
  // one (set_account_approval refuses an admin's). Everything else is decided
  // on the file, with the facts in front of the admin.
  const approvable = account.role !== 'admin' && account.approval_status !== 'approved';
  const approveLabel = account.approval_status === 'rejected' ? t('admin.restoreAccount') : t('admin.approveAccount');
  const approve = () =>
    openDecision({
      lever: { do: 'approval', userId: account.id, status: 'approved' },
      title: `${approveLabel} — ${account.full_name}`,
      body: t('admin.approveAccountBody'),
      confirmLabel: approveLabel,
      reason: 'none',
    });

  return (
    <Card
      accessibilityLabel={`${account.full_name}، ${role}`}
      // The card is one element to VoiceOver: the lever inside it is offered as an action on it.
      accessibilityActions={approvable ? [{ name: 'approve', label: approveLabel }] : undefined}
      onAccessibilityAction={approvable ? (event) => (event.nativeEvent.actionName === 'approve' ? approve() : undefined) : undefined}
      onPress={open}
      style={{ gap: space[3] }}
    >
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
        <ForwardChevron size={18} color={colors.mutedForeground} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
        <ApprovalBadge status={account.approval_status} />
        {account.sign_in_blocked ? <Badge variant="destructive" label={t('admin.signInBlocked')} /> : null}
        {account.agent_restricted ? <Badge variant="destructive" label={t('admin.restricted')} /> : null}
      </View>

      {approvable ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            label={approveLabel}
            accessibilityLabel={`${approveLabel}: ${account.full_name}`}
            size="sm"
            icon={
              account.approval_status === 'rejected' ? (
                <RotateCcw size={16} color={colors.primaryForeground} />
              ) : (
                <Check size={16} color={colors.primaryForeground} />
              )
            }
            onPress={approve}
          />
        </View>
      ) : null}
    </Card>
  );
}
