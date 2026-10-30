import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatNumber } from '@/lib/format';
import { displayJobStatus, jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import type { JobStatus } from '@/lib/supabase/database.types';
import { openDecision, type Decision } from '~/components/admin/decision-sheet';
import { AdminGate, Fact, FlagList, SectionTitle } from '~/components/admin/kit';
import { Record } from '~/components/admin/record';
import { CompanySignalList } from '~/components/admin/signals';
import { Badge } from '~/components/ui/badge';
import { ForwardChevron } from '~/components/ui/icons';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Check, EyeOff, FilePen, Lock, RotateCcw, Star, StarOff, X } from '~/components/ui/lucide';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { TextLink } from '~/components/ui/text-link';
import { APPLICATION_STAGES, useListingFile, UUID, type ListingFile, type ListingReport } from '~/features/admin/listings';
import { markupTags } from '~/i18n/rich';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { useMoney } from '~/features/money';

const STATUS_VARIANT: Record<JobStatus, 'default' | 'outline' | 'success' | 'warning' | 'destructive'> = {
  draft: 'outline',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

/**
 * One listing and the decisions its state allows — the website's
 * /admin/jobs/<id>. The levers offered are exactly the transitions
 * admin_moderate_job accepts from where the listing is now, each with the
 * version the screen showed, so a decision is never made on text that changed
 * after it was read; if somebody else moved it first, the refusal says so and
 * the listing is read again. Every text a reader is shown is here, each under
 * its field's name; the applications as counts per stage (investigating a
 * listing does not need the applicants' names); what the listing's words and
 * its company's doings flag, to weigh; and the record of what admins decided
 * and wrote about it.
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
  const money = useMoney();
  const locale = useLocale();
  const { colors } = useTheme();
  const listing = useListingFile(id);
  const pull = usePullRefresh(() => listing.refetch());

  if (!id) return <NotFoundState />;
  if (listing.isPending) return <LoadingState />;
  if (listing.isError && !listing.data) return <ErrorState error={listing.error} onRetry={() => listing.refetch()} />;
  const job = listing.data;
  if (!job) return <NotFoundState />;

  const n = (value: number) => formatNumber(value, locale);
  const title = localized(locale, job.title_ar, job.title_en) || t('admin.untitled');
  const companyName = localized(locale, job.company.name_ar, job.company.name_en);
  const shown = displayJobStatus(job);
  const texts = [
    { label: t('jobForm.titleAr'), value: job.title_ar },
    { label: t('jobForm.titleEn'), value: job.title_en },
    { label: t('jobForm.descriptionAr'), value: job.description_ar },
    { label: t('jobForm.descriptionEn'), value: job.description_en },
    { label: t('jobForm.requirementsAr'), value: job.requirements_ar },
    { label: t('jobForm.commissionNote'), value: job.commission_note_ar },
  ].filter((text): text is { label: string; value: string } => Boolean(text.value?.trim()));
  const totalApplications = APPLICATION_STAGES.reduce((sum, stage) => sum + job.stages[stage], 0);
  const openReports = job.reports.filter((report) => report.status === 'open' || report.status === 'investigating').length;

  const salary = money.pay(job.basic_salary_min, job.basic_salary_max) ?? t('compensation.noBasicSalary');
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
          <Text variant="title" weight="semibold" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </Text>
          <Badge variant={STATUS_VARIANT[shown]} label={t(`jobStatus.${shown}`)} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
          <Text tone="mutedForeground">{companyName}</Text>
          {job.company.suspended_at ? <Badge variant="destructive" label={t('admin.suspended')} /> : null}
          <Badge
            variant={job.company.verification_status === 'verified' ? 'success' : 'outline'}
            label={t(`admin.verification.${job.company.verification_status}`)}
          />
          {job.is_featured ? <Badge variant="warning" icon={<Star size={12} color={colors.warning} />} label={t('admin.featured')} /> : null}
        </View>
        {/* Anything but a draft has a page of its own, which the website renders as closed once it is. */}
        {job.status !== 'draft' ? (
          <TextLink label={t('admin.publicPage')} onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })} />
        ) : null}
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

      {/* What the listing says, and what its company has been doing, that a
          moderator should weigh before deciding. Facts, not verdicts. */}
      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.safetyHeading')}</SectionTitle>
        <FlagList flags={job.flags} empty />
        <CompanySignalList signals={job.companySignals} empty />
      </Card>

      <Card style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.company')}</SectionTitle>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={companyName}
          onPress={() => router.push({ pathname: '/admin/companies/[id]', params: { id: job.company.id } })}
          style={({ pressed }) => ({ minHeight: hitTarget, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
        >
          <Text weight="medium" tone="primary">
            {companyName}
          </Text>
        </Pressable>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
          <Badge
            variant={job.company.verification_status === 'verified' ? 'success' : 'outline'}
            label={t(`admin.verification.${job.company.verification_status}`)}
          />
          {job.company.suspended_at ? <Badge variant="destructive" label={t('admin.suspended')} /> : null}
        </View>
        <TextLink
          label={t('admin.allCompanyListings')}
          onPress={() => router.push({ pathname: '/admin/jobs', params: { status: 'all', company: job.company.id } })}
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
          <Fact label={t('admin.seats')}>{n(job.seats)}</Fact>
          <Fact label={t('admin.createdAt')}>{formatDate(job.created_at, locale)}</Fact>
          <Fact label={t('admin.publishedAt')}>{job.published_at ? formatDate(job.published_at, locale) : '—'}</Fact>
          <Fact label={t('admin.colExpires')}>{job.expires_at ? formatDate(job.expires_at, locale) : '—'}</Fact>
          <Fact label={t('admin.views')}>{n(job.view_count)}</Fact>
        </View>
        {texts.map((text) => (
          <View key={text.label} style={{ gap: 2 }}>
            <Text variant="caption" tone="mutedForeground">
              {text.label}
            </Text>
            <Text selectable>{text.value}</Text>
          </View>
        ))}
      </Card>

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.applicationsCount', { count: n(totalApplications) })}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {APPLICATION_STAGES.map((stage) => (
            <View key={stage} style={{ minWidth: '30%', flexGrow: 1, gap: 2, padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
              <Text variant="caption" tone="mutedForeground">
                {t(`applicationStatus.${stage}`)}
              </Text>
              <Text variant="headline" weight="semibold">
                {n(job.stages[stage])}
              </Text>
            </View>
          ))}
        </View>
        {totalApplications ? (
          // Every application to this listing, in the console's own list.
          <Button
            label={t('admin.seeAll')}
            variant="ghost"
            size="sm"
            icon={<ForwardChevron size={16} color={colors.foreground} />}
            onPress={() => router.push({ pathname: '/admin/applications', params: { job: job.id } })}
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
          job.reports.map((report) => <ReportCard key={report.id} report={report} />)
        )}
        {openReports ? (
          <View style={{ gap: space[1] }}>
            <Text variant="small">{t('admin.reportCount', { count: openReports })}</Text>
            <TextLink label={t('admin.openReportsQueue')} onPress={() => router.push({ pathname: '/admin/reports', params: { type: 'job' } })} />
          </View>
        ) : null}
      </Card>

      <Record targetType="job" targetId={job.id} />
    </ScrollView>
  );
}

/** One report on the listing: what was alleged, its standing, and who filed it (a link to their file). */
function ReportCard({ report }: { report: ListingReport }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const reporter = report.reporter;
  return (
    <View style={{ gap: 2, padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <Text variant="small" weight="medium" style={{ flex: 1 }}>
          {t(`reportReason.${report.reason}`)}
        </Text>
        <Badge variant="outline" label={t(`admin.reportStatus.${report.status}`)} />
      </View>
      {report.detail ? (
        <Text variant="small" tone="mutedForeground">
          {`«${report.detail.trim()}»`}
        </Text>
      ) : null}
      <Text variant="caption" tone="mutedForeground">
        {reporter ? (
          <Text
            variant="caption"
            tone="primary"
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: reporter.id } })}
          >
            {reporter.full_name}
          </Text>
        ) : (
          t('admin.unknownActor')
        )}
        {` · ${formatDate(report.created_at, locale)}`}
      </Text>
    </View>
  );
}

/** The decisions the listing's state allows, as the website's aside offers them. */
function Levers({ job, title }: { job: ListingFile; title: string }) {
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
  // Featuring is for a listing people can see: live by the date, not the label. No reason: recorded, nobody is told.
  if (jobIsLive(job)) {
    const label = job.is_featured ? t('admin.unfeature') : t('admin.feature');
    buttons.push(
      <Button
        key="featured"
        label={label}
        variant="ghost"
        icon={job.is_featured ? <StarOff size={18} color={colors.foreground} /> : <Star size={18} color={colors.foreground} />}
        onPress={() =>
          openDecision({
            lever: { do: 'featured', jobId: job.id, featured: !job.is_featured },
            title: label,
            body: job.is_featured ? undefined : t('admin.featureBody'),
            confirmLabel: label,
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
