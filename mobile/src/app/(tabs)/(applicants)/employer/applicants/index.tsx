import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Building2, Search, ShieldAlert, ShieldCheck } from '~/components/ui/lucide';
import { formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { isSuspended } from '@/lib/permissions';
import { EXPERIENCE_BANDS, JOB_TRACKS } from '@/lib/taxonomy';
import { ApplicantCard } from '~/components/employer/applicant-card';
import { useApplicantContext } from '~/components/employer/applicant-context';
import { HeaderBell } from '~/components/notifications/header-bell';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import {
  APPLICANTS_CAP,
  notesOf,
  parseInboxFilters,
  STAGES,
  useApplicantNotes,
  useInbox,
  useMarkSeen,
} from '~/features/employer/applicants';
import { markupTags } from '~/i18n/rich';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useSession } from '~/lib/session';
import { useVisited } from '~/lib/use-visited';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/**
 * Every applicant across the company's listings — the website's
 * /employer/applicants inbox: the newest two hundred, narrowed by name, by
 * experience, by the listing's track and by listing, with the stages as chips
 * that count what each holds under the same filters. The filters live in the
 * address, as on the website, so a link (or the overview's "new applicants")
 * opens it narrowed.
 */
export default function InboxScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const params = useLocalSearchParams();
  const filters = parseInboxFilters(params);
  const { session, viewer, actor } = useSession();
  // Drawn at launch behind Home by the tab bar: read once the tab is opened.
  const visited = useVisited();
  const inbox = useInbox(filters, { enabled: visited });
  const rows = inbox.data?.rows;
  const notes = useApplicantNotes((rows ?? []).map((row) => row.id));
  const context = useApplicantContext();
  // Nobody is told a suspended company opened their application: its
  // applicants are hidden from it (migration 349), whatever a read returns.
  useMarkSeen(viewer?.company?.suspended_at ? undefined : rows);
  const [q, setQ] = useState(filters.q);
  // A new applicant, or a colleague's move, reaches the inbox with a pull.
  const pull = usePullRefresh(() => Promise.all([inbox.refetch(), rows?.length ? notes.refetch() : null]));

  const header = (
    <Stack.Screen options={{ title: t('employer.allApplicants'), headerLargeTitle: true, headerRight: () => <HeaderBell /> }} />
  );
  const narrowed = Boolean(filters.q || filters.band || filters.track || filters.job);
  const setFilter = (next: Record<string, string | undefined>) => router.setParams(next as never);

  let body: React.ReactNode;
  if (!session || !viewer?.profile) body = <ViewerPending />;
  else if (isSuspended(actor)) body = <EmptyState icon={ShieldAlert} title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  else if (!viewer.company) {
    body = (
      <EmptyState
        icon={Building2}
        title={t('employer.createCompanyFirst')}
        body={t('employer.createCompanyFirstBody')}
        action={<Button label={t('employer.company')} onPress={() => router.navigate('/employer/company' as never)} />}
      />
    );
  } else if (viewer.company.suspended_at) {
    // A suspended company's applicants are hidden (migration 349): said, not
    // shown as an empty inbox.
    body = <EmptyState icon={ShieldAlert} title={t('employer.applicantsSuspendedTitle')} body={t('employer.applicantsSuspendedBody')} />;
  } else {
    // The listings the rows came from — the choices for narrowing to one.
    const listings = new Map<string, string>();
    for (const row of rows ?? []) if (row.job) listings.set(row.job.id, localized(locale, row.job.title_ar, row.job.title_en));

    body = (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}
        refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      >
        <View style={{ gap: space[2] }}>
          <Text tone="mutedForeground">{t('employer.allApplicantsLede')}</Text>
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <ShieldCheck size={16} color={colors.mutedForeground} style={{ marginTop: 3 }} />
            <Text variant="small" tone="mutedForeground" style={{ flex: 1 }}>
              {t('employer.applicantsPrivacy')}
            </Text>
          </View>
        </View>

        <View style={{ gap: space[3] }}>
          <TextField
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => setFilter({ q: q.trim() || undefined })}
            returnKeyType="search"
            accessibilityLabel={t('employer.searchApplicants')}
            placeholder={t('employer.searchApplicantsPlaceholder')}
            leading={<Search size={18} color={colors.mutedForeground} />}
          />
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <View style={{ flex: 1 }}>
              <Select
                label={t('employer.filterExperience')}
                value={filters.band}
                placeholder={`${t('employer.filterExperience')}: ${t('filters.any')}`}
                options={EXPERIENCE_BANDS.map((value) => ({ value, label: t(`experienceBand.${value}`) }))}
                onChange={(value) => setFilter({ band: value ?? undefined })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Select
                label={t('employer.filterTrack')}
                value={filters.track}
                placeholder={`${t('employer.filterTrack')}: ${t('filters.any')}`}
                options={JOB_TRACKS.map((value) => ({ value, label: t(`track.${value}`) }))}
                onChange={(value) => setFilter({ track: value ?? undefined })}
              />
            </View>
          </View>
          {listings.size > 1 || filters.job ? (
            <Select
              label={t('employer.allListings')}
              value={filters.job}
              placeholder={t('employer.allListings')}
              options={[...listings].map(([value, label]) => ({ value, label }))}
              onChange={(value) => setFilter({ job: value ?? undefined })}
            />
          ) : null}
          {narrowed ? (
            <View style={{ alignItems: 'flex-start' }}>
              <Button
                label={t('employer.filterClear')}
                variant="ghost"
                size="sm"
                onPress={() => {
                  setQ('');
                  setFilter({ q: undefined, band: undefined, track: undefined, job: undefined });
                }}
              />
            </View>
          ) : null}
        </View>

        {/* Where they stand, counted under the same filters. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: space[2] }}
        >
          <Chip
            label={`${t('filters.any')} (${formatNumber(inbox.data?.any ?? 0, locale)})`}
            selected={!filters.stage}
            onPress={() => setFilter({ stage: undefined })}
          />
          {STAGES.map((stage) => (
            <Chip
              key={stage}
              label={`${t(`applicationStatus.${stage}`)} (${formatNumber(inbox.data?.counts[stage] ?? 0, locale)})`}
              selected={filters.stage === stage}
              onPress={() => setFilter({ stage })}
            />
          ))}
        </ScrollView>

        {inbox.isPending ? (
          <LoadingState />
        ) : inbox.isError && !inbox.data ? (
          <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
        ) : !rows?.length ? (
          <View
            style={{
              alignItems: 'center',
              paddingVertical: space[8],
              paddingHorizontal: space[6],
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderStyle: 'dashed',
              borderColor: colors.border,
            }}
          >
            <Text weight="medium" style={{ textAlign: 'center' }}>
              {filters.q ? t('employer.searchEmpty') : filters.band || filters.track ? t('employer.filterEmpty') : t('employer.noApplicants')}
            </Text>
          </View>
        ) : (
          <>
            {rows.map((row) => {
              const jobTitle = row.job ? localized(locale, row.job.title_ar, row.job.title_en) : '';
              return (
                <View key={row.id} style={{ gap: space[1] }}>
                  {row.job ? (
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => router.push(`/employer/jobs/${row.job?.id}/applicants` as never)}
                      hitSlop={{ top: 6, bottom: 6 }}
                      style={{ minHeight: hitTarget - 12, justifyContent: 'center' }}
                    >
                      <Text variant="small" weight="medium" tone="primary">
                        {jobTitle}
                      </Text>
                    </Pressable>
                  ) : null}
                  <ApplicantCard
                    applicant={row}
                    jobTitle={jobTitle}
                    companyName={context.companyName}
                    districtNames={context.districtNames(row.candidate?.agent_profiles?.district_ids ?? [])}
                    notes={notesOf(notes.data, row.id)}
                    authors={notes.data?.authors ?? {}}
                    viewerId={context.viewerId}
                  />
                </View>
              );
            })}
            {rows.length >= APPLICANTS_CAP ? (
              <Text variant="small" tone="mutedForeground">
                {t.markup('employer.applicantsCapped', { count: APPLICANTS_CAP, ...markupTags })}
              </Text>
            ) : null}
          </>
        )}
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
