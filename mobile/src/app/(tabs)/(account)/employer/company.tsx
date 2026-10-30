import { useRef } from 'react';
import { RefreshControl, ScrollView, type ScrollViewInstance } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import { canAccessEmployerArea, isSuspended } from '@/lib/permissions';
import { CompanyForm } from '~/components/employer/company-form';
import { LogoControls } from '~/components/employer/logo-controls';
import { HiringSettings } from '~/components/employer/hiring-settings';
import { CompanyMfaNotice } from '~/components/employer/mfa-required';
import { OwnershipSettings } from '~/components/employer/ownership-settings';
import { RulesSettings } from '~/components/employer/rules-settings';
import { TeamSettings } from '~/components/employer/team-settings';
import { VerificationPanel } from '~/components/employer/verification-panel';
import { SignedOut } from '~/components/navigation/signed-out';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { SuspendedState } from '~/components/ui/suspended-state';
import { Text } from '~/components/ui/text';
import { useCompanyHiring } from '~/features/companies/hiring';
import { useCompanyClosure } from '~/features/employer/closure';
import { useApprovalRequests, useCompanyRules } from '~/features/employer/rules';
import { useCompanyPage } from '~/features/employer/company';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';
import { Compass, History, ShieldCheck } from '~/components/ui/lucide';
import { Num } from '~/components/ui/num';
import { SettingsGroup, SettingsRow } from '~/components/ui/settings-list';
import { usePullRefresh } from '~/lib/use-pull-refresh';

/**
 * The company, as candidates read it and as its admins keep it — the
 * website's /employer/company: the logo, the profile (which makes the
 * company when there is none), the verification papers, and the team. What
 * each person is offered follows their place on the roster, as on the
 * website: a recruiter sees the team and who can change it, not controls the
 * database would refuse.
 */
export default function CompanyScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { session, viewer, actor } = useSession();
  const page = useCompanyPage();
  const pull = usePullRefresh(() => Promise.all([page.refetch(), queryClient.invalidateQueries({ queryKey: ['viewer'] })]));
  const company = viewer?.company ?? null;
  const hiring = useCompanyHiring(company?.id ?? null).data ?? null;
  const closure = useCompanyClosure(company?.id ?? null).data ?? null;
  const rules = useCompanyRules().data ?? null;
  const pendingApprovals = (useApprovalRequests().data ?? []).filter((request) => request.status === 'pending').length;
  const header = <Stack.Screen options={{ title: t('employer.company') }} />;
  const scroll = useRef<ScrollViewInstance>(null);

  let body: React.ReactNode;
  if (!session) body = <SignedOut next="/employer/company" />;
  else if (!viewer?.profile) body = <ViewerPending />;
  else if (!canAccessEmployerArea(actor)) body = <EmptyState icon={Compass} title={t('common.notFound')} body={t('common.notFoundBody')} />;
  else if (isSuspended(actor)) body = <SuspendedState />;
  else if (company && page.isPending) body = <LoadingState />;
  else if (company && page.isError && !page.data) body = <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  else {
    const isAdmin = page.data?.isAdmin ?? false;
    body = (
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.primary} />
        }
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[6] }}
      >
        <Text tone="mutedForeground">{t('employer.companyLede')}</Text>
        <CompanyMfaNotice />
        {company && isAdmin ? (
          <LogoControls
            companyId={company.id}
            companyName={localized(locale, company.name_ar, company.name_en)}
            companySlug={company.slug}
            logoUrl={company.logo_url}
          />
        ) : null}
        {/* Keyed on the company, not its version: a logo or a paper moves the version, and must not wipe what is being typed. */}
        {isAdmin || !company ? <CompanyForm key={company?.id ?? 'new'} company={company} scroll={scroll} /> : null}
        {company && isAdmin ? (
          <VerificationPanel companyId={company.id} status={company.verification_status} documents={page.data?.documents ?? []} />
        ) : null}
        {company && isAdmin && hiring ? <HiringSettings key={company.id} companyId={company.id} hiring={hiring} /> : null}
        {company && page.data ? <TeamSettings members={page.data.team} canManage={isAdmin} /> : null}
        {company && isAdmin && rules ? <RulesSettings key={company.id} rules={rules} /> : null}
        {company && isAdmin && page.data && closure ? (
          <OwnershipSettings
            companyName={company.name_ar}
            team={page.data.team}
            isOwner={page.data.team.some((member) => member.isOwner && member.userId === session.user.id)}
            closure={closure}
          />
        ) : null}
        {company && page.data ? (
          <SettingsGroup>
            <SettingsRow
              icon={<ShieldCheck size={18} color={colors.foreground} />}
              label={t('app.rules.queueRow')}
              hint={t('app.rules.queueRowHint')}
              value={pendingApprovals ? <Num value={pendingApprovals} variant="small" tone="mutedForeground" /> : undefined}
              onPress={() => router.navigate('/employer/approvals' as never)}
              testID="approvals-row"
            />
            <SettingsRow
              icon={<History size={18} color={colors.foreground} />}
              label={t('app.activity.title')}
              hint={isAdmin ? t('app.activity.rowHintAll') : t('app.activity.rowHintOwn')}
              onPress={() => router.navigate('/employer/activity' as never)}
              testID="team-activity"
            />
          </SettingsGroup>
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
