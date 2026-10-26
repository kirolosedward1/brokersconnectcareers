import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { localized } from '@/lib/locale';
import { AdminGate } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { ForwardChevron } from '~/components/ui/icons';
import { Inbox, SearchX } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { SearchField } from '~/components/ui/search-field';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  APPLICATIONS_VIEWS,
  flattenApplications,
  useApplicationList,
  type ApplicationListRow,
  type ApplicationsFilter,
  type ApplicationsView,
} from '~/features/admin/applications';
import { useTabList } from '~/features/tab-bar';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * Applications, for investigating — the website's /admin/applications. There
 * is no lever on this screen or behind it: moving an application is the
 * employer's decision and withdrawing it is the candidate's; an admin who
 * changed either would be putting words in somebody's mouth. What an admin
 * needs is to see what happened — when it was sent, whether it was opened,
 * who moved it and when — which is what one application's page shows.
 *
 * "Unopened" is the complaint support actually receives: "I applied a week
 * ago and nobody looked" — new, never opened, and more than seven days old,
 * the oldest first.
 */
export default function AdminApplicationsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.applications') }} />
      <AdminGate>
        <Applications />
      </AdminGate>
    </>
  );
}

/** The view a link asks for, in the website's own terms (`?status=` on /admin/applications); every application otherwise. */
function viewFor(status: string | undefined): ApplicationsView {
  return (APPLICATIONS_VIEWS as readonly string[]).includes(status ?? '') ? (status as ApplicationsView) : 'all';
}

function useViewLabels(): Record<ApplicationsView, string> {
  const t = useTranslations();
  return {
    all: t('admin.filterAll'),
    unopened: t('admin.unopenedTab'),
    new: t('applicationStatus.new'),
    shortlisted: t('applicationStatus.shortlisted'),
    interview: t('applicationStatus.interview'),
    hired: t('applicationStatus.hired'),
    rejected: t('applicationStatus.rejected'),
  };
}

function one(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function Applications() {
  const t = useTranslations();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ status?: string; job?: string; candidate?: string; q?: string }>();
  const [view, setView] = useState<ApplicationsView>(() => viewFor(params.status));
  const [query, setQuery] = useState(() => one(params.q)?.slice(0, 120) ?? '');
  // One listing's, or one candidate's, applications: what a link asked for, until "show all".
  const [filter, setFilter] = useState<ApplicationsFilter>(() => ({ job: one(params.job), candidate: one(params.candidate) }));
  const applications = useApplicationList(view, query, filter);
  const nextPage = useNextPage(applications);
  const pull = usePullRefresh(() => applications.refetch());
  const list = useTabList<FlashListRef<ApplicationListRow>>();
  const rows = useMemo(() => flattenApplications(applications.data?.pages), [applications.data]);
  const labels = useViewLabels();
  const filtered = Boolean(filter.job || filter.candidate);

  let body: ReactNode = null;
  if (applications.isPending) body = <LoadingState />;
  else if (applications.isError && !applications.data) {
    body = <ErrorState error={applications.error} onRetry={() => applications.refetch()} />;
  }

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('admin.applicationsLede')}
      </Text>
      <View style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
        <Text variant="caption" tone="mutedForeground">
          {t('admin.applicationReadOnly')}
        </Text>
      </View>
      {filtered ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
          <Text variant="small" tone="mutedForeground" style={{ flexShrink: 1 }}>
            {t('admin.filteredToOne')}
          </Text>
          <Button label={t('admin.clearFilter')} variant="ghost" size="sm" onPress={() => setFilter({})} />
        </View>
      ) : null}
      {/* One view at a time: a radio group, as VoiceOver should say it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="radiogroup"
        accessibilityLabel={t('admin.colStatus')}
        contentContainerStyle={{ gap: space[2] }}
      >
        {APPLICATIONS_VIEWS.map((option) => (
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
        placeholder={t('admin.applicationsSearchPlaceholder')}
        onSearch={setQuery}
        style={{ marginHorizontal: gutter, marginTop: space[2], marginBottom: space[1] }}
      />
      <FlashList
        {...list}
        data={body ? [] : rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <ApplicationRow key={item.id} application={item} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          body ??
          // A search that found nothing says so; a view with nothing in it is a queue that is clear.
          (query ? <EmptyState icon={SearchX} title={t('admin.searchNothing')} /> : <EmptyState icon={Inbox} title={t('admin.emptyQueue')} />)
        }
        ListFooterComponent={<PageFooter query={applications} />}
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

/** One application: the candidate, the listing and its company, where it stands, when it was sent, and whether the company opened it. */
function ApplicationRow({ application }: { application: ApplicationListRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const candidate = application.candidate?.full_name ?? '—';
  const listing = localized(locale, application.job.title_ar, application.job.title_en);
  const company = application.job.company ? localized(locale, application.job.company.name_ar, application.job.company.name_en) : '—';

  return (
    <Card
      accessibilityLabel={`${candidate}، ${listing}`}
      onPress={() => router.push({ pathname: '/admin/applications/[id]', params: { id: application.id } })}
      style={{ gap: space[2] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold">{candidate}</Text>
          <Text variant="small" tone="mutedForeground">
            {listing}
          </Text>
          <Text variant="caption" tone="mutedForeground">
            {company}
          </Text>
        </View>
        <ForwardChevron size={18} color={colors.mutedForeground} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        <Badge variant="outline" label={t(`applicationStatus.${application.status}`)} />
        <Text variant="caption" tone="mutedForeground">
          {`${t('admin.colSent')}: ${formatDate(application.created_at, locale)}`}
        </Text>
        <Text variant="caption" tone="mutedForeground">
          {`${t('admin.colOpened')}: ${application.employer_viewed_at ? formatDate(application.employer_viewed_at, locale) : t('admin.notOpened')}`}
        </Text>
      </View>
    </Card>
  );
}
