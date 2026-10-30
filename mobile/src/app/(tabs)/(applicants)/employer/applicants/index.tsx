import { BulkBar, PickBox } from '~/components/employer/bulk-bar';
import { useInterviewsFor } from '~/features/interviews/interviews';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Building2, Layers, Search, ShieldAlert, ShieldCheck } from '~/components/ui/lucide';
import { PIPELINE_STAGES } from '@/lib/application-stages';
import { formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { isSuspended } from '@/lib/permissions';
import { EXPERIENCE_BANDS, JOB_TRACKS } from '@/lib/taxonomy';
import { ApplicantCard } from '~/components/employer/applicant-card';
import { ApplicantReview } from '~/components/employer/applicant-review';
import { useApplicantContext } from '~/components/employer/applicant-context';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, SkeletonList } from '~/components/ui/states';
import { SuspendedState } from '~/components/ui/suspended-state';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import {
  APPLICANTS_CAP,
  notesOf,
  parseInboxFilters,
  useApplicantNotes,
  useInbox,
  useInboxListings,
  useMarkSeen,
} from '~/features/employer/applicants';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useSession } from '~/lib/session';
import { useVisited } from '~/lib/use-visited';
import { useSheet } from '~/lib/use-sheet';
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
  const bell = useHeaderBell();
  const locale = useLocale();
  const { colors } = useTheme();
  const params = useLocalSearchParams();
  const filters = parseInboxFilters(params);
  const { session, viewer, actor } = useSession();
  // Drawn at launch behind Home by the tab bar: read once the tab is opened.
  const visited = useVisited();
  const inbox = useInbox(filters, { enabled: visited });
  const listings = useInboxListings(filters.job, { enabled: visited });
  const choices = listings.data;
  const rows = inbox.data?.rows;
  const notes = useApplicantNotes((rows ?? []).map((row) => row.id));
  const interviews = useInterviewsFor((rows ?? []).map((row) => row.id));
  const interviewOf = (id: string) => (interviews.data ? (interviews.data.get(id) ?? null) : undefined);
  const context = useApplicantContext();
  // Nobody is told a suspended company opened their application: its
  // applicants are hidden from it (migration 349), whatever a read returns.
  useMarkSeen(viewer?.company?.suspended_at ? undefined : rows);
  const [q, setQ] = useState(filters.q);
  // The words in the address changed (a link, the overview, Clear): the box shows them.
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  // A new applicant, a colleague's move or their new listing reaches the inbox with a pull.
  const pull = usePullRefresh(() => Promise.all([inbox.refetch(), rows?.length ? notes.refetch() : null, listings.refetch()]));
  const list = useTabList();
  const review = useSheet();
  const [queue, setQueue] = useState<string[]>([]);
  // Each review begins afresh, at its first applicant: one started again as
  // the last was still sliding away was the same sheet, at the step it ended on.
  const [reviews, setReviews] = useState(0);
  // Select mode (Phase B 01): the applicants chosen, by id; withdrawn ones cannot be.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const pickable = (rows ?? []).filter((row) => row.status !== 'withdrawn');
  const chosen = pickable.filter((row) => picked.has(row.id));
  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  const header = (
    <Stack.Screen options={{ title: t('employer.allApplicants'), headerRight: bell }} />
  );
  const narrowed = Boolean(filters.q || filters.band || filters.track || filters.job);
  const setFilter = (next: Record<string, string | undefined>) => router.setParams(next as never);

  let body: React.ReactNode;
  if (!session || !viewer?.profile) body = <ViewerPending />;
  else if (isSuspended(actor)) body = <SuspendedState />;
  else if (!viewer.company) {
    body = (
      <EmptyState
        icon={Building2}
        illustration="write"
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
    body = (
      <ScrollView
        {...list}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // Room under the last card for the select bar, while it shows.
        contentContainerStyle={{ padding: gutter, paddingBottom: selecting ? space[12] * 4 : space[10], gap: space[4] }}
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
          {choices.length > 1 || filters.job ? (
            <Select
              label={t('employer.allListings')}
              value={filters.job}
              placeholder={t('employer.allListings')}
              options={choices.map((job) => ({ value: job.id, label: localized(locale, job.title_ar, job.title_en) }))}
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
        {/* One stage at a time: a radio group, as VoiceOver should say it. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          accessibilityRole="radiogroup"
          accessibilityLabel={t('employer.stageFilter')}
          contentContainerStyle={{ gap: space[2] }}
        >
          <Chip
            radio
            label={`${t('filters.any')} (${formatNumber(inbox.data?.any ?? 0, locale)})`}
            selected={!filters.stage}
            onPress={() => setFilter({ stage: undefined })}
          />
          {PIPELINE_STAGES.map((stage) => (
            <Chip
              key={stage}
              radio
              label={`${t(`applicationStatus.${stage}`)} (${formatNumber(inbox.data?.counts[stage] ?? 0, locale)})`}
              selected={filters.stage === stage}
              onPress={() => setFilter({ stage })}
            />
          ))}
        </ScrollView>

        {inbox.isPending ? (
          <SkeletonList count={4} compact inset={false} />
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
            {/* A stage chip or a listing empties the list too: "no applicants
                yet" under a chip reading "new 12" is not true. */}
            <Text weight="medium" style={{ textAlign: 'center' }}>
              {filters.q
                ? t('employer.searchEmpty')
                : filters.band || filters.track || filters.job || filters.stage
                  ? t('employer.filterEmpty')
                  : t('employer.noApplicants')}
            </Text>
          </View>
        ) : (
          <>
            {/* One at a time, the moves at the foot of the screen (applicant-review.tsx); or several at once (bulk-bar.tsx). */}
            {selecting ? (
              <View style={{ flexDirection: 'row', gap: space[2] }}>
                <Button
                  label={t('app.bulk.selectAll')}
                  variant="outline"
                  size="sm"
                  onPress={() => setPicked(new Set(pickable.map((row) => row.id)))}
                />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                <View style={{ flexGrow: 1 }}>
                  <Button
                    label={t('app.review.start')}
                    variant="secondary"
                    icon={<Layers size={16} color={colors.secondaryForeground} />}
                    onPress={() => {
                      setQueue(rows.map((row) => row.id));
                      setReviews((count) => count + 1);
                      review.show();
                    }}
                  />
                </View>
                {pickable.length > 1 ? (
                  <Button label={t('app.bulk.select')} variant="outline" onPress={() => setSelecting(true)} />
                ) : null}
              </View>
            )}
            {rows.map((row) => {
              const jobTitle = row.job ? localized(locale, row.job.title_ar, row.job.title_en) : '';
              return (
                <View key={row.id} style={{ gap: space[1] }}>
                  {selecting && row.status !== 'withdrawn' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                      <PickBox name={row.candidate?.full_name ?? '—'} selected={picked.has(row.id)} onToggle={() => toggle(row.id)} />
                      <Text variant="small" style={{ flex: 1 }}>
                        {row.candidate?.full_name ?? '—'}
                      </Text>
                    </View>
                  ) : null}
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
                    interview={interviewOf(row.id)}
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

  const reviewSheet =
    review.mounted && rows ? (
      <ApplicantReview
        key={reviews}
        visible={review.open}
        onClose={(after) => review.hide(after)}
        onDismiss={review.onDismiss}
        queue={queue}
        rows={rows}
        jobTitleOf={(row) => (row.job ? localized(locale, row.job.title_ar, row.job.title_en) : '')}
        companyName={context.companyName}
        districtNamesOf={(row) => context.districtNames(row.candidate?.agent_profiles?.district_ids ?? [])}
        notesOf={(row) => notesOf(notes.data, row.id)}
        interviewOf={(row) => interviewOf(row.id)}
        authors={notes.data?.authors ?? {}}
        viewerId={context.viewerId}
      />
    ) : null;

  return (
    <>
      {header}
      {reviewSheet}
      {body}
      {selecting && rows?.length ? <BulkBar selected={chosen} onDone={stopSelecting} /> : null}
    </>
  );
}
