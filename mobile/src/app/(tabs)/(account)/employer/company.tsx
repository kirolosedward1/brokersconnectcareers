import { RefreshControl, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import { canAccessEmployerArea, isSuspended } from '@/lib/permissions';
import { CompanyForm } from '~/components/employer/company-form';
import { LogoControls } from '~/components/employer/logo-controls';
import { TeamSettings } from '~/components/employer/team-settings';
import { VerificationPanel } from '~/components/employer/verification-panel';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useCompanyPage } from '~/features/employer/company';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

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
  const company = viewer?.company ?? null;
  const header = <Stack.Screen options={{ title: t('employer.company') }} />;

  let body: React.ReactNode;
  if (!session || !viewer?.profile) body = <ViewerPending />;
  else if (!canAccessEmployerArea(actor)) body = <EmptyState title={t('common.notFound')} body={t('common.notFoundBody')} />;
  else if (isSuspended(actor)) body = <EmptyState title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  else if (company && page.isPending) body = <LoadingState />;
  else if (company && page.isError) body = <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  else {
    const isAdmin = page.data?.isAdmin ?? false;
    body = (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={
          <RefreshControl
            refreshing={page.isRefetching}
            onRefresh={() => {
              page.refetch();
              queryClient.invalidateQueries({ queryKey: ['viewer'] });
            }}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
      >
        <Text tone="mutedForeground">{t('employer.companyLede')}</Text>
        {company && isAdmin ? (
          <LogoControls
            companyId={company.id}
            companyName={localized(locale, company.name_ar, company.name_en)}
            companySlug={company.slug}
            logoUrl={company.logo_url}
          />
        ) : null}
        {/* Keyed on the version: a save (or a colleague's, read on refresh) starts the form from what is stored. */}
        {isAdmin || !company ? <CompanyForm key={company ? `${company.id}:${company.version}` : 'new'} company={company} /> : null}
        {company && isAdmin ? (
          <VerificationPanel companyId={company.id} status={company.verification_status} documents={page.data?.documents ?? []} />
        ) : null}
        {company && page.data ? <TeamSettings members={page.data.team} canManage={isAdmin} /> : null}
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
