import { Pressable, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { BriefcaseBusiness, ChartColumn, Building2, Eye, MapPin, Pencil, Plus, Users } from '~/components/ui/lucide';
import { formatDate, formatNumber } from '@/lib/format';
import { displayJobStatus, jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isSuspended } from '@/lib/permissions';
import type { JobStatus } from '@/lib/supabase/database.types';
import { AppealPanel } from '~/components/moderation/appeal-panel';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { PageFooter } from '~/components/ui/page-footer';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { Illustration } from '~/components/ui/illustration';
import { EmptyState, ErrorState, SkeletonScreen } from '~/components/ui/states';
import { SuspendedState } from '~/components/ui/suspended-state';
import { Text } from '~/components/ui/text';
import {
  flattenListings,
  useMyListings,
  type ConsoleListing,
} from '~/features/employer/listings';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { useNextPage } from '~/lib/use-next-page';
import { StatusActions } from '~/components/employer/status-actions';

const STATUS_VARIANT: Record<JobStatus, 'default' | 'success' | 'warning' | 'destructive'> = {
  draft: 'default',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

/**
 * The company's listings — the website's /employer/jobs: every listing and
 * where it stands, by its date as well as its label (a listing past its
 * expiry is shown as ended whatever the nightly relabelling managed), what a
 * moderator said about a rejected one and the way to ask again, and the
 * moves an employer may make: close, submit, reopen. Publishing is a
 * moderator's, and is not offered.
 */
export default function ListingsScreen() {
  const t = useTranslations();
  const bell = useHeaderBell();
  const { colors } = useTheme();
  const { session, viewer, actor } = useSession();
  const listings = useMyListings();
  const nextPage = useNextPage(listings);
  // A push about a new applicant reads the counts again; the spinner is the pull's alone.
  const pull = usePullRefresh(() => listings.refetch());
  const list = useTabList<FlashListRef<ConsoleListing>>();

  const header = (
    <Stack.Screen options={{ title: t('employer.jobs'), headerRight: bell }} />
  );
  const newJob = () => router.push('/employer/jobs/new' as never);

  let body: React.ReactNode;
  if (!session || !viewer?.profile) {
    body = <ViewerPending />;
  } else if (isSuspended(actor)) {
    // The website's console for a suspended account: nothing to act on, said once.
    body = <SuspendedState />;
  } else if (!viewer.company) {
    body = (
      <EmptyState
        icon={Building2}
        illustration="write"
        title={t('employer.createCompanyFirst')}
        body={t('employer.createCompanyFirstBody')}
        action={<Button label={t('employer.company')} onPress={() => router.navigate('/employer/company' as never)} />}
      />
    );
  } else if (listings.isPending) {
    body = <SkeletonScreen />;
  } else if (listings.isError && !listings.data) {
    // Never "post your first listing" to a company whose listings could not be read.
    body = <ErrorState error={listings.error} onRetry={() => listings.refetch()} />;
  } else {
    const rows = flattenListings(listings.data.pages);
    const total = listings.data.pages[0]?.total ?? 0;
    body = (
      <FlashList
        {...list}
        data={rows}
        keyExtractor={(row) => row.id}
        // Keyed on the listing: the list reuses a row's component for another
        // listing as it scrolls, and a half-typed appeal or an error must not go with it.
        renderItem={({ item }) => <ListingRow key={item.id} listing={item} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        // The appeal is typed in a row: the first tap on Send must send, not only close the keyboard.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={
          <View style={{ gap: space[3], marginBottom: space[4] }}>
            <Text tone="mutedForeground">{t('employer.jobsLede')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
              <Text variant="small" tone="mutedForeground">
                {t('jobs.resultsCount', { count: total })}
              </Text>
              <Button label={t('employer.newJob')} size="sm" icon={<Plus size={16} color={colors.primaryForeground} />} onPress={newJob} />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View
            style={{
              alignItems: 'center',
              gap: space[3],
              paddingVertical: space[8],
              paddingHorizontal: space[6],
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderStyle: 'dashed',
              borderColor: colors.border,
            }}
          >
            <Illustration name="write" width={160} />
            <Text weight="medium" style={{ textAlign: 'center' }}>
              {t('employer.noJobs')}
            </Text>
            <Button label={t('employer.newJob')} onPress={newJob} />
          </View>
        }
        ListFooterComponent={<PageFooter query={listings} />}
        onEndReached={nextPage}
        onEndReachedThreshold={0.5}
        {...pull}
      />
    );
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

function ListingRow({ listing }: { listing: ConsoleListing }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();

  const title = localized(locale, listing.title_ar, listing.title_en);
  const live = jobIsLive(listing);
  const shown = displayJobStatus(listing);
  const applicants = listing.applications?.[0]?.count ?? 0;

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: space[1] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
          {live ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: listing.slug } })}
              style={{ flex: 1 }}
            >
              <Text weight="semibold">{title}</Text>
            </Pressable>
          ) : (
            <Text weight="semibold" style={{ flex: 1 }}>
              {title}
            </Text>
          )}
          <Badge variant={STATUS_VARIANT[shown]} label={t(`jobStatus.${shown}`)} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space[3], rowGap: 2 }}>
          {listing.district ? (
            <Meta icon={<MapPin size={14} color={colors.mutedForeground} />}>
              {localized(locale, listing.district.name_ar, listing.district.name_en)}
            </Meta>
          ) : null}
          <Meta icon={<BriefcaseBusiness size={14} color={colors.mutedForeground} />}>
            {`${formatNumber(listing.seats, locale)} ${t('jobs.seatsLabel', { count: listing.seats })}`}
          </Meta>
          {/* On anything ever published: the overview's total is the sum of these. */}
          {listing.published_at ? (
            <Meta icon={<Eye size={14} color={colors.mutedForeground} />}>{formatNumber(listing.view_count, locale)}</Meta>
          ) : null}
          {listing.expires_at && live ? <Meta>{t('jobs.expiresOn', { date: formatDate(listing.expires_at, locale) })}</Meta> : null}
        </View>
      </View>

      {listing.rejection_note ? (
        <View style={{ padding: space[2], ...corner('md'), backgroundColor: colors.destructiveMuted }}>
          <Text variant="caption" tone="destructive">
            {listing.rejection_note}
          </Text>
        </View>
      ) : null}
      {listing.status === 'rejected' ? <AppealPanel subjectType="job" subjectId={listing.id} /> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Button
          label={t.markup('employer.pipelineCount', { count: applicants, ...markupTags })}
          accessibilityLabel={`${t.markup('employer.pipelineCount', { count: applicants, ...markupTags })}: ${title}`}
          variant="outline"
          size="sm"
          icon={<Users size={16} color={colors.primary} />}
          onPress={() => router.push(`/employer/jobs/${listing.id}/applicants` as never)}
        />
        <Button
          label={t('employer.editJob')}
          accessibilityLabel={`${t('employer.editJob')}: ${title}`}
          variant="ghost"
          size="sm"
          icon={<Pencil size={16} color={colors.foreground} />}
          onPress={() => router.push(`/employer/jobs/${listing.id}/edit` as never)}
        />
        {/* How it is doing, and the repost once it has ended (ListingStats). */}
        {listing.status === 'draft' ? null : (
          <Button
            label={t('app.listingStats.open')}
            accessibilityLabel={`${t('app.listingStats.open')}: ${title}`}
            variant="ghost"
            size="sm"
            icon={<ChartColumn size={16} color={colors.foreground} />}
            onPress={() => router.push(`/employer/jobs/${listing.id}/stats` as never)}
          />
        )}
      </View>
      <StatusActions jobId={listing.id} status={shown} title={title} />
    </Card>
  );
}

function Meta({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {icon}
      <Text variant="small" tone="mutedForeground">
        {children}
      </Text>
    </View>
  );
}

