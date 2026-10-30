import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { AdminGate } from '~/components/admin/kit';
import { CompanyLogo } from '~/components/companies/company-logo';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { ForwardChevron } from '~/components/ui/icons';
import { Building2, SearchX } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { SearchField } from '~/components/ui/search-field';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { COMPANIES_VIEWS, countOf, flattenCompanies, useCompanyList, type CompaniesView, type CompanyListRow } from '~/features/admin/companies';
import { useTabList } from '~/features/tab-bar';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * The companies — the website's /admin/companies. It opens on every company,
 * newest first. The verification queue is a view: the company that has waited
 * longest is at its top, and every other view is newest first. Search matches
 * either name or the slug, twenty-five at a time. A row opens the company's
 * page, where its papers, its people, its listings and every lever are.
 */
export default function AdminCompaniesScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.companiesQueue') }} />
      <AdminGate>
        <Companies />
      </AdminGate>
    </>
  );
}

/** The view a link asks for, in the website's own terms (`?status=` on /admin/companies); every company otherwise. */
function viewFor(status: string | undefined): CompaniesView {
  return (COMPANIES_VIEWS as readonly string[]).includes(status ?? '') ? (status as CompaniesView) : 'all';
}

function useViewLabels(): Record<CompaniesView, string> {
  const t = useTranslations();
  return {
    pending: t('admin.verification.pending'),
    verified: t('admin.verification.verified'),
    unverified: t('admin.verification.unverified'),
    rejected: t('admin.verification.rejected'),
    suspended: t('admin.suspended'),
    all: t('admin.filterAll'),
  };
}

function Companies() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ status?: string; q?: string }>();
  const [view, setView] = useState<CompaniesView>(() => viewFor(params.status));
  const [query, setQuery] = useState(() => (typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''));
  const companies = useCompanyList(view, query);
  const nextPage = useNextPage(companies);
  const pull = usePullRefresh(() => companies.refetch());
  const list = useTabList<FlashListRef<CompanyListRow>>();
  const rows = useMemo(() => flattenCompanies(companies.data?.pages), [companies.data]);
  const labels = useViewLabels();

  let body: ReactNode = null;
  if (companies.isPending) body = <LoadingState />;
  else if (companies.isError && !companies.data) body = <ErrorState error={companies.error} onRetry={() => companies.refetch()} />;

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('admin.companiesQueueLede')}
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
        {COMPANIES_VIEWS.map((option) => (
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
        placeholder={t('admin.companiesSearchPlaceholder')}
        onSearch={setQuery}
        style={{ marginHorizontal: gutter, marginTop: space[2], marginBottom: space[1] }}
      />
      <FlashList
        {...list}
        data={body ? [] : rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <CompanyRow key={item.id} company={item} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          body ??
          // A search that found nothing says so; a view with nothing in it is a queue that is clear.
          (query ? <EmptyState icon={SearchX} title={t('admin.searchNothing')} /> : <EmptyState icon={Building2} title={t('admin.emptyQueue')} />)
        }
        ListFooterComponent={<PageFooter query={companies} />}
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

/** One company in the list, with the website's columns: its mark and name, its listings and people counted, its standing, when it joined. */
function CompanyRow({ company }: { company: CompanyListRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const name = localized(locale, company.name_ar, company.name_en);
  const n = (value: number) => formatNumber(value, locale);

  return (
    <Card
      accessibilityLabel={name}
      onPress={() => router.push({ pathname: '/admin/companies/[id]', params: { id: company.id } })}
      style={{ gap: space[3] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <CompanyLogo name={name} logoUrl={company.logo_url} size="sm" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold">{name}</Text>
          <Text variant="small" tone="mutedForeground">
            {`${t('admin.colListings')}: ${n(countOf(company.jobs))} · ${t('admin.colMembers')}: ${n(countOf(company.company_members))}`}
          </Text>
          <Text variant="caption" tone="mutedForeground">
            {`${t('admin.colJoined')}: ${formatDate(company.created_at, locale)}`}
          </Text>
        </View>
        <ForwardChevron size={18} color={colors.mutedForeground} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
        <Badge
          variant={
            company.verification_status === 'verified'
              ? 'success'
              : company.verification_status === 'pending'
                ? 'warning'
                : company.verification_status === 'rejected'
                  ? 'destructive'
                  : 'outline'
          }
          label={t(`admin.verification.${company.verification_status}`)}
        />
        {company.suspended_at ? <Badge variant="destructive" label={t('admin.suspended')} /> : null}
      </View>
    </Card>
  );
}
