import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatEgp, formatNumber } from '@/lib/format';
import { displayJobStatus, jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import type { JobStatus } from '@/lib/supabase/database.types';
import { openDecision, type Decision } from '~/components/admin/decision-sheet';
import { AdminGate, Fact, FlagList, openOnWebsite, SectionTitle } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Check, ExternalLink, EyeOff, FilePen, Lock, RotateCcw, X } from '~/components/ui/lucide';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAdminListing, type AdminListing } from '~/features/admin/queries';
import { markupTags } from '~/i18n/rich';
import { inOwnTab } from '~/lib/links';
import { useSession } from '~/lib/session';
import { tabsFor } from '~/lib/tabs';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

const STATUS_VARIANT: Record<JobStatus, 'default' | 'success' | 'warning' | 'destructive'> = {
  draft: 'default',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

/** A UUID: anything else in the address is no listing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One listing and the decisions its state allows — the website's
 * /admin/jobs/<id>. The levers offered are exactly the transitions
 * admin_moderate_job accepts from where the listing is now, each with the
 * version the screen showed, so a decision is never made on text that changed
 * after it was read; if somebody else moved it first, the refusal says so and
 * the listing is read again. Every text a reader is shown is here, each under
 * its field's name.
 */
export default function AdminListingScreen() {
  const t = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.moderation') }} />
      <AdminGate>
        <Review id={typeof id === 'string' && UUID.test(id) ? id : undefined} />
      </AdminGate>
    </>
  );
}

function Review({ id }: { id: string | undefined }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const actor = useSession().actor;
  const listing = useAdminListing(id);
  const pull = usePullRefresh(() => listing.refetch());
  const openHere = (path: string) => router.push(inOwnTab(path, tabsFor(actor)) as Href);

  if (!id) return <NotFoundState />;
  if (listing.isPending) return <LoadingState />;
  if (listing.isError && !listing.data) return <ErrorState error={listing.error} onRetry={() => listing.refetch()} />;
  const job = listing.data;
  if (!job) return <NotFoundState />;

  const title = localized(locale, job.title_ar, job.title_en) || t('admin.untitled');
  const shown = displayJobStatus(job);
  const live = jobIsLive(job);
  const texts = [
    { label: t('jobForm.titleAr'), value: job.title_ar },
    { label: t('jobForm.titleEn'), value: job.title_en },
    { label: t('jobForm.descriptionAr'), value: job.description_ar },
    { label: t('jobForm.descriptionEn'), value: job.description_en },
    { label: t('jobForm.requirementsAr'), value: job.requirements_ar },
    { label: t('jobForm.commissionNote'), value: job.commission_note_ar },
  ].filter((text): text is { label: string; value: string } => Boolean(text.value?.trim()));

  const salary =
    job.basic_salary_min != null || job.basic_salary_max != null
      ? `${job.basic_salary_min != null ? formatEgp(job.basic_salary_min, locale) : '…'} – ${
          job.basic_salary_max != null ? formatEgp(job.basic_salary_max, locale) : '…'
        } ${t('common.egp')}`
      : t('compensation.noBasicSalary');
  const commission =
    job.commission_type === 'percentage' && job.commission_value != null
      ? t.markup('compensation.commissionPercent', { value: String(job.commission_value), ...markupTags })
      : t(`commissionType.${job.commission_type}`);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[5] }}
    >
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
          <Text variant="title" weight="bold" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </Text>
          <Badge variant={STATUS_VARIANT[shown]} label={t(`jobStatus.${shown}`)} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={localized(locale, job.company.name_ar, job.company.name_en)}
            onPress={() => openHere(`/companies/${job.company.slug}`)}
          >
            <Text tone="primary">{localized(locale, job.company.name_ar, job.company.name_en)}</Text>
          </Pressable>
          {job.company.suspended_at ? <Badge variant="destructive" label={t('admin.suspended')} /> : null}
          <Badge
            variant={job.company.verification_status === 'verified' ? 'success' : 'outline'}
            label={t(`admin.verification.${job.company.verification_status}`)}
          />
        </View>
      </View>

      {job.rejection_note && job.status === 'rejected' ? (
        <View style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.destructiveMuted }}>
          <Text variant="small" tone="destructive">{`${t('admin.rejectionNoteShown')} «${job.rejection_note}»`}</Text>
        </View>
      ) : null}

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.moderation')}</SectionTitle>
        <Levers job={job} title={title} />
      </Card>

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.safetyHeading')}</SectionTitle>
        <FlagList flags={job.flags} empty />
        <Text variant="caption" tone="mutedForeground">
          {t('app.admin.companyRecord')}
        </Text>
        <Button
          label={t('app.admin.onWebsite')}
          variant="ghost"
          size="sm"
          icon={<ExternalLink size={16} color={colors.foreground} />}
          onPress={() => openOnWebsite(`/admin/companies/${job.company.id}`)}
        />
      </Card>

      <Card style={{ gap: space[4] }}>
        <SectionTitle>{t('admin.listingDetails')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[3], columnGap: space[4] }}>
          <Fact label={t('admin.track')}>{t(`track.${job.track}`)}</Fact>
          <Fact label={t('admin.employmentType')}>{t(`employmentType.${job.employment_type}`)}</Fact>
          <Fact label={t('admin.experience')}>{t(`experienceBand.${job.experience_band}`)}</Fact>
          <Fact label={t('admin.district')}>
            {job.district ? localized(locale, job.district.name_ar, job.district.name_en) : '—'}
          </Fact>
          <Fact label={t('compensation.basicSalary')}>{salary}</Fact>
          <Fact label={t('compensation.commission')}>{commission}</Fact>
          <Fact label={t('admin.leads')}>{t(`leadsSource.${job.leads_source}_short`)}</Fact>
          <Fact label={t('admin.seats')}>{formatNumber(job.seats, locale)}</Fact>
          <Fact label={t('admin.createdAt')}>{formatDate(job.created_at, locale)}</Fact>
          <Fact label={t('admin.views')}>{formatNumber(job.view_count, locale)}</Fact>
        </View>
        {texts.map((text) => (
          <View key={text.label} style={{ gap: 2 }}>
            <Text variant="caption" tone="mutedForeground">
              {text.label}
            </Text>
            <Text selectable>{text.value}</Text>
          </View>
        ))}
        {live ? (
          <Button
            label={t('admin.publicPage')}
            variant="outline"
            size="sm"
            icon={<ExternalLink size={16} color={colors.foreground} />}
            onPress={() => openHere(`/jobs/${job.slug}`)}
          />
        ) : null}
      </Card>

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.reportsOnListing')}</SectionTitle>
        {job.reports.length === 0 ? (
          <Text variant="small" tone="mutedForeground">
            {t('admin.noReports')}
          </Text>
        ) : (
          job.reports.map((report) => (
            <View key={report.id} style={{ gap: 2, padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
                <Text variant="small" weight="medium" style={{ flex: 1 }}>
                  {t(`reportReason.${report.reason}`)}
                </Text>
                <Badge variant="outline" label={t(`admin.reportStatus.${report.status}`)} />
              </View>
              {report.detail ? (
                <Text variant="small" tone="mutedForeground">
                  {report.detail}
                </Text>
              ) : null}
              <Text variant="caption" tone="mutedForeground">
                {formatDate(report.created_at, locale)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

/** The decisions the listing's state allows, as the website's aside offers them. */
function Levers({ job, title }: { job: AdminListing; title: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const lever = (decision: Omit<Decision, 'lever'> & { action: Extract<Decision['lever'], { do: 'job' }>['action'] }) => {
    const { action, ...words } = decision;
    // Review decisions carry the version read here; a take-down or a close is about now, whatever was read.
    const versioned = action === 'approve' || action === 'reject' || action === 'request_changes' || action === 'restore';
    openDecision({ ...words, lever: { do: 'job', jobId: job.id, action, version: versioned ? job.version : undefined } });
  };

  const buttons: ReactNode[] = [];
  if (job.status === 'pending_review') {
    buttons.push(
      <Button
        key="approve"
        label={t('admin.approve')}
        accessibilityLabel={`${t('admin.approve')}: ${title}`}
        icon={<Check size={18} color={colors.primaryForeground} />}
        onPress={() =>
          lever({
            action: 'approve',
            title: t('admin.approveListingTitle'),
            body: t('admin.approveListingBody'),
            confirmLabel: t('admin.approve'),
            reason: 'none',
          })
        }
      />,
      <Button
        key="changes"
        label={t('admin.requestChanges')}
        variant="outline"
        icon={<FilePen size={18} color={colors.foreground} />}
        onPress={() =>
          lever({
            action: 'request_changes',
            title: t('admin.requestChanges'),
            body: t('admin.requestChangesListingBody'),
            confirmLabel: t('admin.requestChanges'),
            reason: 'required',
            reasonLabel: t('admin.reasonToCompany'),
          })
        }
      />,
      <Button
        key="reject"
        label={t('admin.reject')}
        variant="ghost"
        icon={<X size={18} color={colors.destructive} />}
        onPress={() =>
          lever({
            action: 'reject',
            title: t('admin.rejectListingTitle'),
            body: t('admin.rejectListingBody'),
            confirmLabel: t('admin.reject'),
            destructive: true,
            reason: 'required',
            reasonLabel: t('admin.reasonToCompany'),
          })
        }
      />,
    );
  }
  if (job.status === 'active') {
    buttons.push(
      <Button
        key="unpublish"
        label={t('admin.unpublish')}
        variant="outline"
        icon={<EyeOff size={18} color={colors.destructive} />}
        onPress={() =>
          lever({
            action: 'unpublish',
            title: t('admin.unpublishTitle'),
            body: t('admin.unpublishBody'),
            confirmLabel: t('admin.unpublish'),
            destructive: true,
            reason: 'required',
            reasonLabel: t('admin.reasonToCompany'),
          })
        }
      />,
    );
  }
  if (job.status === 'active' || job.status === 'expired') {
    buttons.push(
      <Button
        key="close"
        label={t('admin.closeListing')}
        variant="ghost"
        icon={<Lock size={18} color={colors.foreground} />}
        onPress={() =>
          lever({
            action: 'close',
            title: t('admin.closeListing'),
            body: t('admin.closeListingBody'),
            confirmLabel: t('admin.closeListing'),
            reason: 'required',
          })
        }
      />,
    );
  }
  if (job.status === 'rejected') {
    buttons.push(
      <Button
        key="restore"
        label={t('admin.restoreListing')}
        variant="outline"
        icon={<RotateCcw size={18} color={colors.success} />}
        onPress={() =>
          lever({
            action: 'restore',
            title: t('admin.restoreListing'),
            body: t('admin.restoreListingBody'),
            confirmLabel: t('admin.restoreListing'),
            reason: 'none',
          })
        }
      />,
    );
  }

  if (!buttons.length) {
    return (
      <Text variant="small" tone="mutedForeground">
        {job.status === 'draft' ? t('admin.draftNoLever') : t('admin.closedNoLever')}
      </Text>
    );
  }
  return <View style={{ gap: space[2] }}>{buttons}</View>;
}
