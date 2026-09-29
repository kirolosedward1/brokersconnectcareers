import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { Archive, BriefcaseBusiness, Eye, MapPin, Pencil, Plus, RotateCcw, SendHorizontal, Users } from 'lucide-react-native';
import { formatDate, formatNumber } from '@/lib/format';
import { displayJobStatus, jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isSuspended } from '@/lib/permissions';
import type { JobStatus } from '@/lib/supabase/database.types';
import { AppealPanel } from '~/components/moderation/appeal-panel';
import { HeaderBell } from '~/components/notifications/header-bell';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  flattenListings,
  TransitionRefused,
  useMyListings,
  useTransitionJob,
  type ConsoleListing,
} from '~/features/employer/listings';
import { markupTags } from '~/i18n/rich';
import { ApiError } from '~/lib/api';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

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
  const { colors } = useTheme();
  const { session, viewer, actor } = useSession();
  const listings = useMyListings();

  const header = (
    <Stack.Screen options={{ title: t('employer.jobs'), headerLargeTitle: true, headerRight: () => <HeaderBell /> }} />
  );
  const newJob = () => router.push('/employer/jobs/new' as never);

  let body: React.ReactNode;
  if (!session || !viewer?.profile) {
    body = <ViewerPending />;
  } else if (isSuspended(actor)) {
    // The website's console for a suspended account: nothing to act on, said once.
    body = <EmptyState title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  } else if (!viewer.company) {
    body = (
      <EmptyState
        title={t('employer.createCompanyFirst')}
        body={t('employer.createCompanyFirstBody')}
        action={<Button label={t('employer.company')} onPress={() => router.navigate('/employer/company' as never)} />}
      />
    );
  } else if (listings.isPending) {
    body = <LoadingState />;
  } else if (listings.isError) {
    // Never "post your first listing" to a company whose listings could not be read.
    body = <ErrorState error={listings.error} onRetry={() => listings.refetch()} />;
  } else {
    const rows = flattenListings(listings.data.pages);
    const total = listings.data.pages[0]?.total ?? 0;
    body = (
      <FlashList
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <ListingRow listing={item} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10] }}
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
              borderRadius: radius.xl,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: colors.border,
            }}
          >
            <Text weight="medium" style={{ textAlign: 'center' }}>
              {t('employer.noJobs')}
            </Text>
            <Button label={t('employer.newJob')} onPress={newJob} />
          </View>
        }
        onEndReached={() => {
          if (listings.hasNextPage && !listings.isFetchingNextPage) listings.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={listings.isRefetching && !listings.isFetchingNextPage}
        onRefresh={() => listings.refetch()}
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
        <View style={{ padding: space[2], borderRadius: radius.md, backgroundColor: colors.destructiveMuted }}>
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
function StatusActions({ jobId, status, title }: { jobId: string; status: JobStatus; title: string }) {
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
        icon={<SendHorizontal size={16} color={colors.primary} />}
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
