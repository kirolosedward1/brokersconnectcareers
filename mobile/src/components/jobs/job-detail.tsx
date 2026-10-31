import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useLocale, useTranslations } from 'use-intl';
import { VerifiedMark } from '~/components/companies/verified-mark';
import { BriefcaseBusiness, CalendarClock, CalendarX2, Clock, Eye, MapPin, Share, Users } from '~/components/ui/lucide';
import type { JobDetailResponse } from '@/lib/mobile-api/reads';
import { formatDate, formatNumber, formatRate, formatRelativeDay } from '@/lib/format';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isApproved, isCandidate } from '@/lib/permissions';
import { buildLandingSlug } from '@/lib/taxonomy';
import { CompanyLogo } from '~/components/companies/company-logo';
import { HiddenNotice } from '~/components/moderation/hide-company';
import { ReportButton } from '~/components/moderation/report';
import { SavedJobNote } from '~/components/saved/note-sheet';
import { FoldedText } from '~/components/ui/folded-text';
import { SaveJobButton } from '~/components/saved/save-controls';
import { CompensationCard } from '~/components/jobs/compensation-card';
import { JobCard } from '~/components/jobs/job-card';
import { Appear } from '~/components/motion/appear';
import { BarOnly } from '~/components/navigation/page-header';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ForwardChevron, SendForward } from '~/components/ui/icons';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { recentJobs, useListOwner, viewedFrom } from '~/features/jobs/recent';
import { takeSharedArrival } from '~/features/jobs/arrival';
import { useCompensationText } from '~/features/jobs/compensation';
import { useCompanyResponse } from '~/features/companies/response';
import { TABULAR } from '~/components/ui/num';
import { isolate, markupTags } from '~/i18n/rich';
import { analyticsRole } from '~/lib/analytics-role';
import { track } from '~/lib/analytics';
import { formatMonthYear } from '~/lib/month-year';
import { ShareCardSheet } from './share-card';
import { useAppliedJobIds } from '~/features/jobs/marks';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useHiddenJobs, withoutHiddenJobs } from '~/features/moderation/hidden-jobs';
import { shareJobLink } from '~/features/jobs/share';
import { useShrinkingTabBar } from '~/features/tab-bar';
import { callAction } from '~/lib/api';
import { PausedNotice } from '~/components/companies/hiring-notice';
import { useCompanyHiring } from '~/features/companies/hiring';
import { useSession } from '~/lib/session';
import { useHasBoard } from '~/lib/use-tabs';
import { useToBoard } from '~/features/jobs/to-board';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { dialog } from '~/lib/dialog';
import { useSheet } from '~/lib/use-sheet';

/**
 * One listing — the website's JobDetailView, in the order a phone reads it:
 * who and where, what kind of role, what it pays (above any prose), the next
 * step, the description and what is asked, the developers' projects, the
 * dates and views, the company, and roles like it.
 *
 * Open means open by the date, not by the label (jobIsLive), and a closed
 * listing stays readable with the next step that still exists: the board.
 *
 * The next step stays in reach: once Apply — or, applied already, the way to
 * the application — has scrolled up out of sight, the same button is pinned
 * in a bar at the foot of the screen, above the tab bar, until the reader is
 * back up where it is. The other next steps (closed, an employer's, a
 * suspended candidate's) are words to read where they are, and are not
 * pinned.
 */
export function JobDetail({
  data,
  refreshing,
  onRefresh,
}: {
  data: JobDetailResponse;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { job, similar, reference } = data;
  const locale = useLocale();
  const t = useTranslations('jobs');
  const tTrack = useTranslations('track');
  const tType = useTranslations('employmentType');
  const tExp = useTranslations('experienceBand');
  const tLanding = useTranslations('landing');
  const tApply = useTranslations('apply');
  const tComp = useTranslations('compensation');
  const tListing = useTranslations('app.listing');
  const large = useLargeText();
  const pinnedPay = useCompensationText().salary(job);
  const pinnedRate = job.commission_type === 'percentage' && job.commission_value != null ? formatRate(job.commission_value, locale) : null;
  const shrink = useShrinkingTabBar();
  const { colors } = useTheme();
  const { session, viewer, actor } = useSession();

  const open = jobIsLive(job);
  const title = localized(locale, job.title_ar, job.title_en);
  const description = localized(locale, job.description_ar, job.description_en);
  const companyName = localized(locale, job.company.name_ar, job.company.name_en);
  const districtName = localized(locale, job.district.name_ar, job.district.name_en);
  const role = viewer?.profile?.role;
  const canApply = !role || role === 'candidate';
  const applied = useAppliedJobIds([job.id]).has(job.id);
  // A company that paused hiring takes no application (migration 378); its listing says so.
  const hiring = useCompanyHiring(job.company.id).data ?? null;
  const paused = hiring !== null && !hiring.open;
  const hasBoard = useHasBoard();
  const toBoard = useToBoard();
  // Like it, and not already applied to: those are done with, as Home's suggestions leave them out.
  const similarApplied = useAppliedJobIds(similar.map((item) => item.id));
  const similarShown = withoutHiddenJobs(withoutHidden(similar, useHiddenCompanies()), useHiddenJobs()).filter((item) => !similarApplied.has(item.id));

  // A view is a reader opening an open listing, once per visit — the website
  // counts the page render the same way (recordJobView, after the response).
  const counted = useRef<string | null>(null);
  // Kept on this phone for Home's "recently viewed" (features/jobs/recent.ts).
  const owner = useListOwner();
  useEffect(() => {
    recentJobs.add(owner, viewedFrom(job));
    // Once per listing opened; a refresh of the same page changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, job.id]);
  useEffect(() => {
    if (!open || counted.current === job.slug) return;
    counted.current = job.slug;
    callAction('recordJobView', { slug: job.slug }).catch(() => {});
    // The funnel's first two steps: arrived from a forwarded link, and read.
    const shared = takeSharedArrival(job.slug);
    if (shared) track('arrived_from_share', {});
    track('job_viewed', { role: analyticsRole(actor, Boolean(session)), from: shared ? 'share' : 'other' });
    // Once per listing opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job.slug]);

  // Applying is for an account: signed out, Apply is the sign-in sheet, which comes back to the form.
  const apply = () => {
    track('apply_clicked', { role: analyticsRole(actor, Boolean(session)) });
    if (!session) {
      router.push({ pathname: '/sign-in', params: { next: `/jobs/${job.slug}/apply` } });
      return;
    }
    router.push({ pathname: '/jobs/[slug]/apply', params: { slug: job.slug } });
  };
  const toApplications = () => router.navigate('/dashboard/applications');
  // What is pinned at the foot once the step has scrolled away: Apply, or the application already sent.
  const pinnable = open && canApply && (applied || (!paused && !(isCandidate(actor) && !isApproved(actor))));
  // The Apply button shows (the last branch of the next step below), so the bookmark sits beside it.
  const applyOffered = open && canApply && !applied && !(paused && hiring) && !(isCandidate(actor) && !isApproved(actor));
  // Where the step's foot is in the page, and whether the page is scrolled past it.
  const [stepEnd, setStepEnd] = useState<number | null>(null);
  const [pastStep, setPastStep] = useState(false);
  // The tab bar growing smaller as the page goes down, and — with something to pin — the pinned bar.
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    shrink.onScroll(event);
    // Set only when it changes way: the same answer draws nothing again.
    if (pinnable) setPastStep(stepEnd !== null && event.nativeEvent.contentOffset.y > stepEnd);
  };

  const shareLink = () => shareJobLink({ slug: job.slug, title });
  // The link, or the listing as a picture for a status or a story (share-card.tsx).
  const card = useSheet();
  const tApp = useTranslations('app.share');
  const tCommon = useTranslations('common');
  const share = () => {
    const options = [tApp('asLink'), tApp('asImage'), tCommon('cancel')];
    const pick = (index: number) => {
      if (index === 0) shareLink();
      if (index === 1) card.show();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 2 }, pick);
    } else {
      dialog.alert(t('share'), undefined, [
        { text: options[0], onPress: () => pick(0) },
        { text: options[1], onPress: () => pick(1) },
        { text: options[2], style: 'cancel' },
      ]);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <BarOnly>
              {/* The system's share symbol, as iOS's own bars have it: the word is
                  VoiceOver's, and the bar never has to grow with the text. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('share')}
                onPress={share}
                hitSlop={4}
                style={({ pressed }) => ({
                  width: hitTarget,
                  height: hitTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.55 : 1,
                })}
              >
                <SymbolView
                  name="square.and.arrow.up"
                  size={20}
                  weight="medium"
                  tintColor={colors.foreground}
                  fallback={<Share size={20} color={colors.foreground} />}
                />
              </Pressable>
            </BarOnly>
          ),
        }}
      />
      {card.mounted ? <ShareCardSheet job={job} visible={card.open} onClose={card.hide} onDismiss={card.onDismiss} /> : null}
      <ScrollView
        testID="job-detail"
        contentInsetAdjustmentBehavior="automatic"
        onScroll={onScroll}
        scrollEventThrottle={shrink.scrollEventThrottle}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        // Room at the foot for the pinned bar, so the page's last lines are not under it.
        contentContainerStyle={{ padding: gutter, paddingBottom: pinnable ? space[12] + PINNED : space[12], gap: space[6] }}
      >
        <HiddenNotice companyId={job.company.id} />

        {open ? null : (
          <Notice tone="warning" title={t('expired')} icon={<CalendarX2 size={16} color={colors.warning} />}>
            {t('expiredBody')}
          </Notice>
        )}

        <View style={{ gap: space[4] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <CompanyLogo name={companyName} logoUrl={job.company.logo_url} />
            <View style={{ flex: 1, gap: space[0.5] }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[2], rowGap: space[0.5] }}>
                <Text
                  variant="small"
                  weight="semibold"
                  tone="primary"
                  accessibilityRole="link"
                  onPress={() => router.push({ pathname: '/companies/[slug]', params: { slug: job.company.slug } })}
                >
                  {companyName}
                </Text>
                {job.company.verification_status === 'verified' ? <VerifiedMark size={15} /> : null}
              </View>
              {/* Where, how fresh, and since when the company is verified (v1.1). */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
                <MapPin size={13} color={colors.mutedForeground} />
                <Text variant="caption" tone="mutedForeground" style={{ flexShrink: 1 }}>
                  {[
                    districtName,
                    job.published_at ? tListing('postedAgo', { when: formatRelativeDay(job.published_at, locale) }) : null,
                    job.company.verification_status === 'verified' && job.company.verified_at
                      ? tListing('verifiedSince', { when: formatMonthYear(job.company.verified_at, locale) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
          </View>

          {/* A size under the screen titles: a long title takes two lines, not four (owner's call, 31 Oct). */}
          <Text variant="title" weight="bold" accessibilityRole="header">
            {title}
          </Text>
        </View>

        {/* Pay first, under the title (owner's call, 31 Oct); the facts and how fast the company answers after it. */}
        <CompensationCard job={job} reference={reference} />

        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Fact>{tTrack(job.track)}</Fact>
            <Fact>{tType(job.employment_type)}</Fact>
            {/* A span of years reads right to left, the fewer years at the right. */}
            <Fact icon={<Users size={13} color={colors.mutedForeground} />}>{`${RLI}${tExp(job.experience_band)}${PDI}`}</Fact>
            {/* The open seats as an icon and the number; VoiceOver hears the words. */}
            <Fact
              icon={<BriefcaseBusiness size={13} color={colors.mutedForeground} />}
              accessibilityLabel={`${formatNumber(job.seats, locale)} ${t('seatsLabel', { count: job.seats })}`}
            >
              {formatNumber(job.seats, locale)}
            </Fact>
          </View>

          <ResponseLine companyId={job.company.id} />
        </View>

        {/* The next step. Applying arrives with sign-in; until then, and for
            anyone the button cannot work for, the page says what is true. */}
        <View testID="next-step" onLayout={({ nativeEvent: { layout } }) => setStepEnd(layout.y + layout.height)}>
          {!open ? (
            <Card style={{ gap: space[3] }}>
              <Text variant="small" tone="mutedForeground">
                {job.expires_at ? t('closedOn', { date: formatDate(job.expires_at, locale) }) : t('closedCtaBody')}
              </Text>
              {hasBoard ? <Button label={t('browseOpen')} onPress={toBoard} /> : null}
            </Card>
          ) : !canApply ? (
            <Card>
              <Text variant="small" tone="mutedForeground">
                {tApply('employerCannotApply')}
              </Text>
            </Card>
          ) : applied ? (
            <Card style={{ gap: space[3] }}>
              <Text variant="small" weight="medium" tone="success">
                {tApply('alreadyApplied')}
              </Text>
              <Button label={tApply('viewApplications')} variant="outline" onPress={toApplications} />
            </Card>
          ) : paused && hiring ? (
            <PausedNotice hiring={hiring} />
          ) : isCandidate(actor) && !isApproved(actor) ? (
            // The database would refuse the application; say why before the form.
            <Card style={{ gap: space[1] }}>
              <Text weight="semibold">{tApply('suspendedTitle')}</Text>
              <Text variant="small" tone="mutedForeground">
                {tApply('suspendedBody')}
              </Text>
            </Card>
          ) : (
            // Apply, and the bookmark beside it as an icon (owner's call, 31 Oct).
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={t('apply')}
                  size="lg"
                  icon={<SendForward size={18} color={colors.primaryForeground} />}
                  onPress={apply}
                />
              </View>
              <SaveJobButton jobId={job.id} slug={job.slug} compact />
            </View>
          )}
        </View>

        {/* Where there is no Apply to sit beside, the bookmark keeps its own row; a candidate's, or the way to sign in. */}
        {applyOffered ? null : <SaveJobButton jobId={job.id} slug={job.slug} />}
        {/* Saved, it carries the candidate's own note, kept on this phone. */}
        <SavedJobNote jobId={job.id} title={title} />

        <Section title={t('description')}>
          <FoldedText>{description}</FoldedText>
        </Section>

        {job.requirements_ar ? (
          <Section title={t('requirements')}>
            <FoldedText>{job.requirements_ar}</FoldedText>
          </Section>
        ) : null}

        {job.job_developers.length ? (
          <Section title={t('developers')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {job.job_developers.map(({ developer }) => (
                <Fact key={developer.id}>{localized(locale, developer.name_ar, developer.name_en)}</Fact>
              ))}
            </View>
          </Section>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space[4], rowGap: space[1] }}>
          {job.published_at ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
              <CalendarClock size={13} color={colors.mutedForeground} />
              <Text variant="caption" tone="mutedForeground">
                {t('postedOn', { date: formatDate(job.published_at, locale) })}
              </Text>
            </View>
          ) : null}
          {job.expires_at ? (
            <Text variant="caption" tone="mutedForeground">
              {t(open ? 'expiresOn' : 'endedOn', { date: formatDate(job.expires_at, locale) })}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Eye size={13} color={colors.mutedForeground} />
            <Text variant="caption" tone="mutedForeground">
              {t('views', { count: job.view_count })}
            </Text>
          </View>
        </View>

        {/* The company as one row, opening its page (owner's call, 31 Oct): what it says about itself is there. */}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${t('aboutCompany')}: ${companyName}`}
          accessibilityHint={t('companyPage')}
          onPress={() => router.push({ pathname: '/companies/[slug]', params: { slug: job.company.slug } })}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            padding: space[3],
            ...corner('xl'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.border,
            backgroundColor: pressed ? colors.muted : colors.card,
          })}
        >
          <CompanyLogo name={companyName} logoUrl={job.company.logo_url} size="sm" />
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Text weight="semibold" numberOfLines={large ? undefined : 1} style={{ flexShrink: 1 }}>
              {companyName}
            </Text>
            {job.company.verification_status === 'verified' ? <VerifiedMark size={15} /> : null}
          </View>
          <ForwardChevron size={16} color={colors.mutedForeground} />
        </Pressable>

        {similarShown.length ? (
          <Section title={t('similarJobs')}>
            <View style={{ gap: space[2] }}>
              {similarShown.map((item) => (
                <JobCard key={item.id} job={item} />
              ))}
            </View>
          </Section>
        ) : null}

        {/* More of the same kind, at the foot. */}
        <Pressable
          accessibilityRole="link"
          onPress={() =>
            router.push({ pathname: '/jobs/[slug]', params: { slug: buildLandingSlug(job.track, job.district.slug) } })
          }
          hitSlop={8}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space[0.5], alignSelf: 'flex-start', minHeight: hitTarget, opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="small" weight="medium" tone="primary">
            {tLanding('title', { track: tTrack(job.track), district: districtName })}
          </Text>
          <ForwardChevron size={14} color={colors.primary} />
        </Pressable>

        <View style={{ alignItems: 'flex-start' }}>
          <ReportButton target="job" targetId={job.id} returnPath={`/jobs/${job.slug}`} label={t('report')} />
        </View>
      </ScrollView>
      {pinnable && pastStep ? (
        <Appear
          testID="pinned-step"
          from="below"
          distance={8}
          duration={240}
          style={[styles.pinned, { backgroundColor: colors.background, borderTopColor: colors.border }]}
        >
          {applied ? (
            <Button label={tApply('viewApplications')} variant="outline" onPress={toApplications} />
          ) : (
            <View style={{ gap: space[1.5] }}>
              {/* What it pays, beside the way to apply (v1.1): the basic, and the commission rate when there is one. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                {pinnedPay.unit ? (
                  <View style={{ flexShrink: 1 }}>
                    <Text variant="label" tone="mutedForeground">
                      {tComp('basicSalary')}
                    </Text>
                    <Text weight="bold" tone="primary" style={TABULAR} numberOfLines={large ? undefined : 1}>
                      {pinnedPay.amount}
                      {pinnedRate !== null ? <Text variant="caption" weight="semibold" tone="goldForeground">{`  ${isolate(`+${pinnedRate}%`)}`}</Text> : null}
                    </Text>
                  </View>
                ) : null}
                <View style={{ flexGrow: 1 }}>
                  <Button label={t('apply')} icon={<SendForward size={18} color={colors.primaryForeground} />} onPress={apply} />
                </View>
              </View>
            </View>
          )}
        </Appear>
      ) : null}
    </>
  );
}

/** The pinned bar's height, about: the pay, a button, the line under it and the room round them. */
const PINNED = 112;

/**
 * How this company answers, from what it did with the applications it got
 * (migration 370): the median days to a first answer and the share it opened,
 * over the last half year. Nothing when it has had too few to say.
 */
function ResponseLine({ companyId }: { companyId: string }) {
  const t = useTranslations('app.listing');
  const { colors } = useTheme();
  const stats = useCompanyResponse(companyId).data;
  if (!stats) return null;
  const parts = [
    stats.medianDays !== null ? t.markup('respondsIn', { days: Math.max(0, Math.round(stats.medianDays)), ...markupTags }) : null,
    t.markup('opened', { percent: Math.round(stats.openRate * 100), ...markupTags }),
  ].filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2], padding: space[3], ...corner('lg'), backgroundColor: colors.successMuted }}>
      <Clock size={15} color={colors.success} style={{ marginTop: 2 }} />
      <Text variant="caption" weight="semibold" tone="success" style={{ flex: 1 }}>
        {parts.join(' · ')}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ gap: space[3], paddingTop: space[5], borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border }}
    >
      <Text variant="headline" weight="semibold" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** One fact about the role, as a quiet pill. */
function Fact({ icon, children, accessibilityLabel }: { icon?: React.ReactNode; children: string; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessible={accessibilityLabel ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1],
        paddingHorizontal: space[2.5],
        paddingVertical: space[1],
        ...corner('full'),
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
      }}
    >
      {icon}
      <Text variant="small" weight="medium">
        {children}
      </Text>
    </View>
  );
}

/** A right-to-left isolate: a span like «1 – 3 سنوات» keeps its order inside a line of either direction. */
const RLI = '\u2067';
const PDI = '\u2069';

const styles = StyleSheet.create({
  // At the foot of the screen, which ends above the tab bar's band: a hairline over it, the page's own colour.
  pinned: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    paddingHorizontal: gutter,
    paddingTop: space[3],
    paddingBottom: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
