import { CandidateInterview } from '~/components/interviews/interview-panels';
import { useMyInterviews } from '~/features/interviews/interviews';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useIsFocused } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Building2, ChevronDown, Eye, MapPin, UserRound } from '~/components/ui/lucide';
import { formatDate, formatRelativeDay } from '@/lib/format';
import { STAGE_TONE, canWithdraw } from '@/lib/application-stages';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { displayJobStatus } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { ApplicationTimeline } from '~/components/applications/timeline';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Illustration } from '~/components/ui/illustration';
import { ClearedApplications } from '~/components/applications/cleared-applications';
import { EmptyState, ErrorState, SkeletonScreen } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  daysWithoutAnswer,
  lastMovedAt,
  QUIET_DAYS,
  useMyApplications,
  useWithdrawApplication,
  type CandidateApplication,
} from '~/features/applications/queries';
import { useCompanyResponse } from '~/features/companies/response';
import { applyQueue } from '~/features/apply/queue';
import { Segmented } from '~/components/ui/segmented';
import { markupTags } from '~/i18n/rich';
import { useMarkStagesSeen } from '~/features/applications/moved';
import { useTabList } from '~/features/tab-bar';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { ConfirmDialog } from '~/components/ui/confirm-dialog';
import { toast } from '~/components/feedback/toast';
import { useListMotion } from '~/components/motion/list-motion';

/**
 * The candidate's applications — the website's /dashboard/applications: every
 * role applied to and where it stands, what the company said when it said
 * anything, whether anybody has opened it yet, and what became of the listing.
 */
export default function ApplicationsScreen() {
  const t = useTranslations();
  const bell = useHeaderBell();
  const { colors, shadow } = useTheme();
  const { session } = useSession();
  const applications = useMyApplications();
  const [view, setView] = useState<'all' | 'news' | 'interviews' | 'ended'>('all');
  // In view, what each application stands at is seen: the tab's badge for a move goes (features/applications/moved.ts).
  useMarkStagesSeen(applications.data, useIsFocused() && Boolean(session));
  // A push about a move reads the list again; the spinner is the pull's alone.
  const pull = usePullRefresh(() => applications.refetch());
  const list = useTabList();
  // Withdrawn, or decided and moved under its heading: the rows close up rather than jump.
  useListMotion((applications.data ?? []).map((application) => `${application.id}:${application.status}`));

  let body: React.ReactNode;
  if (!session) {
    body = (
      <EmptyState
        icon={UserRound}
        title={t('app.account.signedOutTitle')}
        action={<Button label={t('nav.signIn')} onPress={() => router.push('/sign-in')} />}
      />
    );
  } else if (applications.isPending) {
    body = <SkeletonScreen />;
  } else if (applications.isError && !applications.data) {
    // Never "you have not applied" for a read that failed.
    body = <ErrorState error={applications.error} onRetry={() => applications.refetch()} />;
  } else {
    const all = applications.data.filter((application) => application.job);
    // Which of them, as the segments at the top choose (v1.1): all, those with news this week, interviews, the ended.
    const news = all.filter(hasNews);
    const rows =
      view === 'news'
        ? news
        : view === 'interviews'
          ? all.filter((application) => application.status === 'interview')
          : view === 'ended'
            ? all.filter((application) => DECIDED.has(application.status) || application.status === 'withdrawn')
            : all;
    const active = rows.filter((application) => !DECIDED.has(application.status));
    const decided = rows.filter((application) => DECIDED.has(application.status));
    body = (
      <ScrollView
        {...list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}
        refreshControl={
          <RefreshControl {...pull} tintColor={colors.primary} />
        }
      >
        {/* Written with no connection, waiting to go (features/apply/queue.ts). */}
        <QueuedApplications />

        {all.length ? (
          <Segmented
            label={t('app.applications.segmentsLabel')}
            value={view}
            onChange={setView}
            options={[
              { value: 'all', label: t.markup('app.applications.segmentAll', { count: all.length, ...markupTags }) },
              { value: 'news', label: t.markup('app.applications.segmentNews', { count: news.length, ...markupTags }) },
              { value: 'interviews', label: t('app.applications.segmentInterviews') },
              { value: 'ended', label: t('app.applications.segmentEnded') },
            ]}
          />
        ) : null}

        {all.length && rows.length === 0 ? (
          <Text tone="mutedForeground" style={{ textAlign: 'center', paddingVertical: space[6] }}>
            {t('app.applications.segmentEmpty')}
          </Text>
        ) : rows.length === 0 ? (
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
            <Illustration name="apply" width={140} />
            <Text weight="medium" style={{ textAlign: 'center' }}>
              {t('dashboard.emptyApplications')}
            </Text>
            <Button label={t('dashboard.emptyApplicationsCta')} onPress={() => router.navigate('/jobs')} />
          </View>
        ) : (
          // Still open first, decided after: what may yet move is what is
          // looked for. Each group one surface of ruled rows — the website's
          // layout, not a card per application — and named only when both are there.
          <View style={{ gap: space[5] }}>
            {[active, decided].map((group, index) =>
              group.length ? (
                <View key={index} style={{ gap: space[2] }}>
                  {active.length && decided.length ? (
                    <Text variant="small" weight="semibold" tone="mutedForeground" accessibilityRole="header">
                      {t(index === 0 ? 'app.applications.activeHeading' : 'app.applications.decidedHeading')}
                    </Text>
                  ) : null}
                  <View
                    style={{
                      ...corner('xl'),
                      borderWidth: StyleSheet.hairlineWidth * 2,
                      borderColor: colors.border,
                      boxShadow: shadow.card,
                      backgroundColor: colors.card,
                      overflow: 'hidden',
                    }}
                  >
                    {group.map((application, row) => (
                      <ApplicationRow key={application.id} application={application} first={row === 0} />
                    ))}
                  </View>
                </View>
              ) : null,
            )}
          </View>
        )}

        {/* What a company cleared or took with it when it closed (Phase B 07c). */}
        {view === 'all' || view === 'ended' ? <ClearedApplications /> : null}
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{ title: t('dashboard.applications'), headerRight: bell }}
      />
      {body}
    </>
  );
}

/** Where an application has come to its end: the company has answered. */
const DECIDED = new Set<ApplicationStatus>(['hired', 'rejected']);

/** News this week: the company moved it in the last seven days. */
function hasNews(application: CandidateApplication): boolean {
  const moved = lastMovedAt(application);
  return Boolean(moved) && Date.now() - new Date(moved as string).getTime() < QUIET_DAYS * 24 * 60 * 60 * 1000;
}

function ApplicationRow({ application, first }: { application: CandidateApplication; first: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const withdraw = useWithdrawApplication();
  const [failed, setFailed] = useState<'unavailable' | 'failed' | null>(null);
  // One read for the whole list (the query is shared): this application's invitation, if any.
  const invite = useMyInterviews().data?.get(application.id) ?? null;
  const [openedAt] = useState(() => Date.now());
  const [asking, setAsking] = useState(false);
  // The four steps, folded under the status until asked for (owner's call, 31 Oct: half the height).
  const [expanded, setExpanded] = useState(false);

  const job = application.job;
  if (!job) return null;

  const title = localized(locale, job.title_ar, job.title_en);
  const shown = displayJobStatus(job);
  const moved = lastMovedAt(application);
  const quiet = daysWithoutAnswer(application);
  const quietStrip = quiet !== null && quiet >= QUIET_DAYS && canWithdraw(application.status);

  // Asked in the app's own direction, not iOS's alert, which an English iPhone lays out left to right.
  const confirmWithdraw = () => setAsking(true);
  const withdrawNow = () => {
    setAsking(false);
    setFailed(null);
    withdraw.mutate(application.id, {
      onSuccess: () => toast.show({ message: t('app.toast.withdrawn'), tone: 'success' }),
      onError: (error) => setFailed(error instanceof Error && error.message === 'unavailable' ? 'unavailable' : 'failed'),
    });
  };
  const withdrawQuestion = (
    <ConfirmDialog
      visible={asking}
      title={t('myApplications.withdrawTitle', { title })}
      message={t('myApplications.withdrawBody')}
      cancelLabel={t('common.cancel')}
      confirmLabel={t('dashboard.withdraw')}
      destructive
      onCancel={() => setAsking(false)}
      onConfirm={withdrawNow}
    />
  );

  return (
    <View
      style={{
        gap: space[2],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <View style={{ flex: 1, gap: space[0.5] }}>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })}
          >
            <Text weight="semibold">{title}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space[3], rowGap: space[0.5] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
              <Building2 size={14} color={colors.mutedForeground} />
              <Text variant="small" tone="mutedForeground">
                {localized(locale, job.company.name_ar, job.company.name_en)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
              <MapPin size={14} color={colors.mutedForeground} />
              <Text variant="small" tone="mutedForeground">
                {localized(locale, job.district.name_ar, job.district.name_en)}
              </Text>
            </View>
          </View>
        </View>
        {application.status === 'withdrawn' ? (
          <Badge label={t('applicationStatus.withdrawn')} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${t(`applicationStatus.${application.status}`)}. ${expanded ? t('app.applications.hideSteps') : t('app.applications.showSteps')}`}
            onPress={() => setExpanded(!expanded)}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], minHeight: 32 }}
          >
            <Badge variant={STAGE_TONE[application.status]} label={t(`applicationStatus.${application.status}`)} />
            <ChevronDown size={16} color={colors.mutedForeground} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
          </Pressable>
        )}
      </View>

      {/* Where it stands: sent, seen by the company, shortlisted, the decision — opened from the status. */}
      {expanded ? <ApplicationTimeline application={application} /> : null}

      {/* An interview the company invited them to, and their answer (migration 373). */}
      {invite && application.status !== 'withdrawn' ? <CandidateInterview invite={invite} now={openedAt} /> : null}

      {/* That a person at the company has had it on screen — only while the
          outcome is open; once the status moves, the status is the news. */}
      {application.status === 'new' && application.employer_viewed_at ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          <Eye size={14} color={colors.success} />
          <Text variant="caption" weight="medium" tone="success">
            {t('dashboard.applicationOpened')}
          </Text>
        </View>
      ) : null}

      {/* A week and more at «new», nothing heard (v1.1): how long, how soon this company usually answers, and the way out. */}
      {quietStrip ? (
        <QuietStrip days={quiet} companyId={job.company.id ?? null} busy={withdraw.isPending} onWithdraw={confirmWithdraw} />
      ) : null}

      {/* What happened to the listing, by its date as well as its label. */}
      {shown !== 'active' ? (
        <Aside color={colors.border}>
          <Text variant="caption" tone="mutedForeground">
            {shown === 'closed' || shown === 'expired'
              ? t('dashboard.applicationListingClosed')
              : t('dashboard.applicationListingOffBoard')}
          </Text>
        </Aside>
      ) : null}

      {/* The reason, when the company gave one. */}
      {application.decision_note ? (
        <Aside color={colors.primary}>
          <Text variant="caption" weight="medium" tone="mutedForeground">
            {t('dashboard.decisionFromCompany')}
          </Text>
          <Text variant="small">{application.decision_note}</Text>
        </Aside>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <Text variant="caption" tone="mutedForeground" style={{ flexShrink: 1 }}>
          {[
            moved ? t('app.applications.movedAgo', { when: formatRelativeDay(moved, locale) }) : null,
            t('dashboard.appliedOn', { date: formatDate(application.created_at, locale) }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {/* The quiet strip above already offers it: not twice. */}
        {canWithdraw(application.status) && !quietStrip ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: withdraw.isPending }}
            disabled={withdraw.isPending}
            onPress={confirmWithdraw}
            hitSlop={8}
            style={{ minHeight: 36, justifyContent: 'center', opacity: withdraw.isPending ? 0.5 : 1 }}
          >
            {/* Red, because withdrawing is the one that cannot be taken back. */}
            <Text variant="small" weight="medium" tone="destructive">
              {t('dashboard.withdraw')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {failed ? (
        <Text variant="caption" tone="destructive" accessibilityRole="alert">
          {failed === 'unavailable' ? t('myApplications.withdrawUnavailable') : t('common.errorBody')}
        </Text>
      ) : null}
      {withdrawQuestion}
    </View>
  );
}

/** The applications waiting on this phone for a connection, each with the way to call it off. */
function QueuedApplications() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { session } = useSession();
  const owner = session?.user.id ?? 'anon';
  const waiting = applyQueue.useItems(owner);
  if (!waiting.length) return null;
  return (
    <View style={{ gap: space[2] }}>
      {waiting.map((item) => {
        const title = localized(locale, item.titleAr, item.titleEn);
        return (
          <View
            key={item.jobId}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], ...corner('xl'), borderWidth: 1, borderColor: colors.champagne, backgroundColor: colors.card }}
          >
            <View style={{ flex: 1, gap: space[0.5] }}>
              <Text weight="semibold">{t('app.applications.queuedTitle')}</Text>
              <Text variant="caption" tone="mutedForeground">
                {title}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('app.applications.queuedCancel')}: ${title}`}
              onPress={() => applyQueue.remove(owner, item.jobId)}
              style={{ minHeight: hitTarget, paddingHorizontal: space[2], justifyContent: 'center' }}
            >
              <Text variant="small" weight="medium" tone="destructive">
                {t('app.applications.queuedCancel')}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/**
 * «لم تردّ بعد منذ N أيام», the company's usual answer time beside it when it
 * has one (migration 370), and Withdraw a tap away.
 */
function QuietStrip({ days, companyId, busy, onWithdraw }: { days: number; companyId: string | null; busy: boolean; onWithdraw: () => void }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const usual = useCompanyResponse(companyId).data?.medianDays ?? null;
  const said = [
    t.markup('app.applications.quietFor', { days, ...markupTags }),
    usual !== null && companyId ? t.markup('app.applications.usuallyIn', { days: Math.max(0, Math.round(usual)), ...markupTags }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], paddingStart: space[3], ...corner('md'), backgroundColor: colors.warningMuted }}>
      <Text variant="caption" style={{ flex: 1, color: colors.warning, paddingVertical: space[2] }}>
        {said}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={said}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={onWithdraw}
        style={{ minHeight: hitTarget, paddingHorizontal: space[3], justifyContent: 'center' }}
      >
        <Text variant="small" weight="semibold" tone="destructive">
          {t('dashboard.withdraw')}
        </Text>
      </Pressable>
    </View>
  );
}

/** A sentence about the row it sits in: a rule down its leading edge, no box. */
function Aside({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <View style={{ borderStartWidth: 2, borderStartColor: color, paddingStart: space[3], gap: space[0.5] }}>{children}</View>
  );
}
