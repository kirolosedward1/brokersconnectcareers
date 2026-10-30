import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { employerNextAction } from '@/lib/employer-next-action';
import { formatDate, formatNumber } from '@/lib/format';
import { displayJobStatus, jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isSuspended } from '@/lib/permissions';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
import { ConversionBars } from '~/components/dashboard/conversion-bars';
import { NextAction } from '~/components/dashboard/next-action';
import { StandingNotice } from '~/components/dashboard/standing-notice';
import { PolicyNotice } from '~/components/legal/policy-notice';
import { PushPrompt } from '~/components/push/push-prompt';
import { StatRowPlaceholder } from '~/components/dashboard/stat-row';
import { StatStrip } from '~/components/dashboard/stat-strip';
import { TrendBars } from '~/components/dashboard/trend-bars';
import { SetupChecklist } from '~/components/employer/setup-checklist';
import { Hero } from '~/components/home/hero';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { ChevronDown, Plus } from '~/components/ui/lucide';
import { Num } from '~/components/ui/num';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { flattenListings, useMyListings, type ConsoleListing } from '~/features/employer/listings';
import { useEmployerSummary, useEmployerTrend } from '~/features/employer/overview';
import { useTodaysInterviews } from '~/features/interviews/interviews';
import { useApprovalRequests } from '~/features/employer/rules';
import { useCompanyPage } from '~/features/employer/company';
import { CompanyMfaNotice } from '~/components/employer/mfa-required';
import { markupTags } from '~/i18n/rich';
import { useTabList } from '~/features/tab-bar';
import { noAnswer } from '~/lib/api';
import { routeInside } from '~/lib/links';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { PressableScale } from '~/components/ui/pressable-scale';

/**
 * An employer's Home — the website's /employer overview, drawn as the
 * EmployerHome board: the company and what it has live, then what needs the
 * employer today, each with its one way to act — applicants nobody at the
 * company has opened, the listing that ends soonest, listings that have
 * ended (repost), listings in review, the posting credit — then the
 * listings themselves, and the figures folded under one heading (the work
 * first, the company's standing a step quieter, the month of applications
 * and how each listing converts). Before there is a listing the setup
 * checklist says what is left. The board's interviews of the day wait for
 * interview scheduling (Phase B).
 *
 * A suspended account sees its standing and the appeal — which the website's
 * console, replacing every page, never shows it.
 */
export function EmployerHome({ profile, company }: { profile: ProfileRow | null; company: CompanyRow | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { actor } = useSession();
  const summary = useEmployerSummary();
  const trend = useEmployerTrend();

  const s = summary.data ?? null;
  const n = (value: number) => formatNumber(value, locale);
  // Posted, in review or since ended: a listing people apply to (a draft is not one yet).
  const hasListing = Boolean(s?.has_company && s.live_jobs + s.pending_jobs + s.ended_jobs > 0);
  const go = (href: string) => router.navigate(routeInside(href, actor) as never);

  const listings = useMyListings();
  const rows = flattenListings(listings.data?.pages);
  const [figuresOpen, setFiguresOpen] = useState(false);
  // When Home was opened: what "today" and "within the week" are measured from.
  const [now] = useState(() => Date.now());
  const today = useTodaysInterviews(Boolean(s?.has_company), now);
  // What waits for an admin; a member who is not one sees no row (the policy gives them only their own asks).
  const approvals = useApprovalRequests().data ?? [];
  const companyAdmin = useCompanyPage({ enabled: Boolean(s?.has_company) }).data?.isAdmin ?? false;
  const waiting = companyAdmin ? approvals.filter((request) => request.status === 'pending').length : 0;
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' });

  // The spinner is the pull's alone: a push about a new applicant reads the
  // overview again too, and a spinner that starts by itself pushes the page
  // down under the reader's finger.
  const pull = usePullRefresh(() =>
    Promise.all([
      summary.refetch(),
      trend.refetch(),
      queryClient.invalidateQueries({ queryKey: ['viewer'] }),
      queryClient.invalidateQueries({ queryKey: ['account', 'note'] }),
      queryClient.invalidateQueries({ queryKey: ['employer', 'suspension'] }),
      queryClient.invalidateQueries({ queryKey: ['appeal'] }),
      listings.refetch(),
    ]),
  );
  const list = useTabList();


  const header =
    s?.has_company && company ? (
      <Hero
        compact
        title={localized(locale, company.name_ar, company.name_en)}
        subtitle={[
          s.verification === 'verified' ? t('companies.verified') : t('companies.unverified'),
          t.markup('app.employerHome.live', { count: s.live_jobs, ...markupTags }),
        ].join(' · ')}
      />
    ) : (
      <Hero compact title={t('dashboard.overview')} subtitle={t('dashboard.employerLede')} />
    );
  const standing = profile ? <StandingNotice profile={profile} company={company} /> : null;

  let body: React.ReactNode;
  if (summary.isPending) {
    body = <StatRowPlaceholder count={3} label={t('common.loading')} />;
  } else if (summary.isError && !summary.data) {
    body = (
      <View style={{ gap: space[3], alignItems: 'flex-start' }}>
        <Notice tone="destructive">{noAnswer(summary.error) ? t('app.offline.body') : t('common.errorBody')}</Notice>
        <Button label={t('common.retry')} variant="outline" size="sm" onPress={() => summary.refetch()} />
      </View>
    );
  } else if (!s || !s.has_company) {
    body = isSuspended(actor) ? null : (
      <View
        style={{
          alignItems: 'center',
          gap: space[2],
          paddingVertical: space[8],
          paddingHorizontal: space[6],
          ...corner('xl'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderStyle: 'dashed',
          borderColor: colors.border,
        }}
      >
        <Text weight="medium" style={{ textAlign: 'center' }}>
          {t('dashboard.emptyEmployerTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
          {t('dashboard.emptyEmployerBody')}
        </Text>
        <View style={{ marginTop: space[2] }}>
          <Button label={t('dashboard.emptyEmployerCta')} onPress={() => go('/employer/company')} />
        </View>
      </View>
    );
  } else {
    const next = employerNextAction(s);
    const listed = s.live_jobs + s.pending_jobs > 0;
    // Against a week with no applicants a change is noise, so there is none.
    const delta =
      s.applicants_prev_7d > 0
        ? {
            value: `${n(Math.round(((s.applicants_7d - s.applicants_prev_7d) / s.applicants_prev_7d) * 100))}%`,
            direction:
              s.applicants_7d > s.applicants_prev_7d
                ? ('up' as const)
                : s.applicants_7d < s.applicants_prev_7d
                  ? ('down' as const)
                  : ('flat' as const),
          }
        : undefined;

    // The listing that ends soonest within the week, for its own line.
    const soon = rows
      .filter((row) => jobIsLive(row) && row.expires_at && new Date(row.expires_at).getTime() - now < 7 * 86_400_000)
      .sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)))[0];
    const queue: QueueEntry[] = [
      // Declines and pay changes a colleague asked an admin for (migration 380).
      ...(waiting > 0
        ? [{ key: 'approvals', count: waiting, title: t('app.rules.queueRow'), body: t('app.rules.queueRowHint'), cta: t('app.employerHome.review'), strong: true, href: '/employer/approvals' }]
        : []),
      ...(s.applicants_unseen > 0
        ? [{ key: 'unseen', count: s.applicants_unseen, title: t('app.employerHome.unseen'), body: t('app.employerHome.unseenBody'), cta: t('app.employerHome.review'), strong: true, href: '/employer/applicants?stage=new' }]
        : []),
      // Today's interviews, by name and Cairo time (migration 373); the board's «مقابلتان اليوم».
      ...(today.data?.length
        ? [{
            key: 'interviews',
            count: today.data.length,
            title: t('app.interview.todayTitle'),
            body: today.data.map((row) => `${row.name} ${clock.format(new Date(row.starts_at))}`).join(' · '),
            cta: null,
            href: `/employer/jobs/${today.data[0]?.jobId}/applicants`,
          }]
        : []),
      ...(soon
        ? [{
            key: 'expiring',
            count: null,
            title: t('app.employerHome.expiring', { title: localized(locale, soon.title_ar, soon.title_en), date: formatDate(soon.expires_at as string, locale) }),
            body: t.markup('app.employerHome.expiringBody', { count: soon.applications?.[0]?.count ?? 0, ...markupTags }),
            cta: t('app.employerHome.openListing'),
            href: `/employer/jobs/${soon.id}/stats`,
          }]
        : s.expiring_soon > 0
          ? [{ key: 'expiring', count: s.expiring_soon, title: t('app.employerHome.expiringMore'), body: null, cta: t('app.employerHome.openListing'), href: '/employer/jobs' }]
          : []),
      ...(s.ended_jobs > 0
        ? [{ key: 'ended', count: s.ended_jobs, title: t('app.employerHome.ended'), body: t('app.employerHome.endedBody'), cta: t('app.employerHome.repost'), href: '/employer/jobs' }]
        : []),
      ...(s.pending_jobs > 0
        ? [{ key: 'pending', count: s.pending_jobs, title: t('app.employerHome.pending'), body: t('app.employerHome.pendingBody'), cta: null, href: '/employer/jobs' }]
        : []),
      ...(listed
        ? [{ key: 'credits', count: s.credits, title: t('app.employerHome.credits'), body: t('app.employerHome.creditsBody'), cta: t('app.employerHome.billing'), href: '/employer/billing' }]
        : []),
    ];
    // The one next action stays for what the queue does not carry: a refused
    // verification, applicants opened but not yet decided, a draft to finish.
    const nextShown =
      next && (next.key === 'Verification' || next.key === 'Draft' || (next.key === 'Applicants' && s.applicants_unseen === 0)) ? next : null;

    body = (
      <>
        <CompanyMfaNotice />
        {nextShown ? (
          <NextAction
            kind={nextShown.kind}
            tone={nextShown.tone}
            title={t(`dashboard.next${nextShown.key}Title` as 'dashboard.nextApplicantsTitle', { count: nextShown.count })}
            body={t(`dashboard.next${nextShown.key}Body` as 'dashboard.nextApplicantsBody')}
            cta={t(`dashboard.next${nextShown.key}Cta` as 'dashboard.nextApplicantsCta')}
            onPress={() => go(nextShown.href)}
          />
        ) : null}

        {listed ? (
          <View style={{ gap: space[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space[2] }}>
              <Text variant="headline" weight="semibold" accessibilityRole="header">
                {t('app.employerHome.today')}
              </Text>
              <Text variant="caption" tone="mutedForeground">
                {formatDate(new Date(now), locale)}
              </Text>
            </View>
            {queue.length ? (
              queue.map((entry) => <QueueItem key={entry.key} entry={entry} onPress={() => go(entry.href)} />)
            ) : (
              <Text variant="small" tone="mutedForeground">
                {t('app.employerHome.nothing')}
              </Text>
            )}
          </View>
        ) : (
          <SetupChecklist company={company} liveJobs={s.live_jobs} pendingJobs={s.pending_jobs} draftJobs={s.draft_jobs} />
        )}

        {standing}

        {rows.length ? (
          <View style={{ gap: space[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
              <Text variant="headline" weight="semibold" accessibilityRole="header">
                {t('app.employerHome.myListings')}
              </Text>
              <Button
                label={t('app.employerHome.addListing')}
                variant="ghost"
                size="sm"
                icon={<Plus size={16} color={colors.primary} />}
                onPress={() => go('/employer/jobs/new')}
              />
            </View>
            {rows.slice(0, 3).map((row) => (
              <ListingLine key={row.id} listing={row} onPress={() => go(row.status === 'draft' ? `/employer/jobs/${row.id}/edit` : `/employer/jobs/${row.id}/stats`)} />
            ))}
            {rows.length > 3 ? (
              <Button label={t('app.employerHome.allListings')} variant="outline" size="sm" onPress={() => go('/employer/jobs')} />
            ) : null}
          </View>
        ) : null}

        {listed ? (
          <View style={{ gap: space[3] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: figuresOpen }}
              onPress={() => setFiguresOpen((open) => !open)}
              style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: space[2] }}
            >
              <Text weight="medium" tone="primary" style={{ flex: 1 }}>
                {t('app.employerHome.figures')}
              </Text>
              <View style={{ transform: [{ rotate: figuresOpen ? '180deg' : '0deg' }] }}>
                <ChevronDown size={18} color={colors.primary} />
              </View>
            </Pressable>
            {figuresOpen ? (
              <>
                <StatStrip
                  label={t('dashboard.overview')}
                  cells={[
                    {
                      label: t('dashboard.statApplicantsNew'),
                      value: n(s.applicants_new),
                      tone: s.applicants_new > 0 ? 'accent' : 'default',
                      onPress: () => go('/employer/applicants?stage=new'),
                    },
                    {
                      label: t('dashboard.statApplicants7d'),
                      value: n(s.applicants_7d),
                      hint: delta ? t('dashboard.vsLastWeek') : undefined,
                      delta,
                      onPress: () => go('/employer/applicants'),
                    },
                    {
                      label: t('dashboard.statExpiring'),
                      value: n(s.expiring_soon),
                      tone: s.expiring_soon > 0 ? 'urgent' : 'default',
                      onPress: () => go('/employer/jobs'),
                    },
                    { label: t('dashboard.statLiveJobs'), value: n(s.live_jobs), onPress: () => go('/employer/jobs') },
                    {
                      label: t('dashboard.statPending'),
                      value: n(s.pending_jobs),
                      tone: s.pending_jobs > 0 ? 'warn' : 'default',
                      onPress: () => go('/employer/jobs'),
                    },
                  ]}
                />
                <StatStrip
                  label={t('employer.company')}
                  cells={[
                    { label: t('dashboard.statViews'), value: n(s.total_views), onPress: () => go('/employer/jobs') },
                    { label: t('dashboard.statSeats'), value: n(s.seats_advertised), onPress: () => go('/employer/jobs') },
                    { label: t('dashboard.statCredits'), value: n(s.credits), onPress: () => go('/employer/billing') },
                    {
                      label: t('dashboard.statVerification'),
                      value: s.verification === 'verified' ? t('companies.verified') : t('companies.unverified'),
                      tone: s.verification === 'verified' ? 'good' : 'warn',
                      onPress: () => go('/employer/company'),
                    },
                  ]}
                />
                {trend.data?.has_company ? (
                  <>
                    <TrendBars
                      title={t('dashboard.trendApplicationsTitle')}
                      hint={t('dashboard.trendApplicationsHint')}
                      days={trend.data.days.map((day) => day.d)}
                      values={trend.data.days.map((day) => day.applications)}
                      empty={t('dashboard.trendEmpty')}
                      totalLabel={t('dashboard.statApplicants')}
                    />
                    <ConversionBars rows={trend.data.conversion} />
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <ScrollView
      {...list}
      contentInsetAdjustmentBehavior="automatic"
      // An appeal is typed on Home: its Send takes the first tap, and the field is lifted above the keyboard.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      refreshControl={
        <RefreshControl {...pull} tintColor={colors.primary} />
      }
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[6] }}
    >
      {header}
      {/* Without a company (and so without figures) the standing still comes first. */}
      {s?.has_company ? null : standing}
      {/* The Terms and the Privacy policy as they are now, until agreed to. */}
      {profile ? <PolicyNotice /> : null}
      {/* The phone's question, once there is a listing for someone to apply to. */}
      {profile && hasListing ? <PushPrompt audience="employer" /> : null}
      {body}
    </ScrollView>
  );
}

type QueueEntry = {
  key: string;
  /** The figure in the tile at the start, when there is one to draw. */
  count: number | null;
  title: string;
  body: string | null;
  cta: string | null;
  /** The one that needs the employer most: drawn in the brand's navy. */
  strong?: boolean;
  href: string;
};

/** One thing waiting on the employer, and the way to it: a link to VoiceOver, named by its words and figure. */
function QueueItem({ entry, onPress }: { entry: QueueEntry; onPress: () => void }) {
  const { colors, lift } = useTheme();
  const ink = entry.strong ? colors.primaryForeground : colors.foreground;
  return (
    <PressableScale
      accessibilityRole="link"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        padding: space[4],
        ...corner('xl'),
        borderWidth: entry.strong ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: entry.strong ? colors.primary : colors.card,
        ...(entry.strong ? {} : lift),
      }}
    >
      {entry.count != null ? (
        <View
          style={{
            minWidth: 40,
            height: 40,
            paddingHorizontal: space[2],
            ...corner('lg'),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: entry.strong ? 'rgba(255,255,255,0.12)' : colors.accent,
          }}
        >
          <Num value={entry.count} weight="bold" style={{ color: entry.strong ? colors.secondary : colors.accentForeground }} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: space[0.5] }}>
        <Text variant="small" weight="semibold" style={{ color: ink }}>
          {entry.title}
        </Text>
        {entry.body ? (
          <Text variant="caption" style={{ color: entry.strong ? colors.primaryForeground : colors.mutedForeground }}>
            {entry.body}
          </Text>
        ) : null}
      </View>
      {entry.cta ? (
        <View
          style={{
            minHeight: 32,
            paddingHorizontal: space[3],
            justifyContent: 'center',
            ...corner('full'),
            backgroundColor: entry.strong ? colors.secondary : colors.card,
            borderWidth: entry.strong ? 0 : 1,
            borderColor: colors.border,
          }}
        >
          <Text variant="caption" weight="semibold" style={{ color: entry.strong ? colors.secondaryForeground : colors.primary }}>
            {entry.cta}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

const LINE_VARIANT = { active: 'success', pending_review: 'warning', rejected: 'destructive' } as const;

/** A listing on Home: its title, seats and applicants, where it stands. */
function ListingLine({ listing, onPress }: { listing: ConsoleListing; onPress: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors, lift } = useTheme();
  const shown = displayJobStatus(listing);
  return (
    <PressableScale
      accessibilityRole="link"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        padding: space[4],
        ...corner('xl'),
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        ...lift,
      }}
    >
      <View style={{ flex: 1, gap: space[0.5] }}>
        <Text variant="small" weight="semibold">
          {localized(locale, listing.title_ar, listing.title_en)}
        </Text>
        <Text variant="caption" tone="mutedForeground">
          {t.markup('app.employerHome.listingLine', { seats: listing.seats, applicants: listing.applications?.[0]?.count ?? 0, ...markupTags })}
        </Text>
      </View>
      <Badge label={t(`jobStatus.${shown}`)} variant={shown in LINE_VARIANT ? LINE_VARIANT[shown as keyof typeof LINE_VARIANT] : 'default'} />
    </PressableScale>
  );
}
