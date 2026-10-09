import { useEffect, useRef } from 'react';
import { ActionSheetIOS, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { VerifiedMark } from '~/components/companies/verified-mark';
import { BadgeCheck, Building2, CalendarClock, CalendarX2, Eye, MapPin, Share2, Users } from '~/components/ui/lucide';
import type { JobDetailResponse } from '@/lib/mobile-api/reads';
import { formatDate, formatNumber } from '@/lib/format';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isApproved, isCandidate } from '@/lib/permissions';
import { withShareSource } from '@/lib/share-source';
import { buildLandingSlug } from '@/lib/taxonomy';
import { CompanyLogo } from '~/components/companies/company-logo';
import { HiddenNotice } from '~/components/moderation/hide-company';
import { ReportButton } from '~/components/moderation/report';
import { SaveJobButton } from '~/components/saved/save-controls';
import { CompensationCard } from '~/components/jobs/compensation-card';
import { JobCard } from '~/components/jobs/job-card';
import { Badge } from '~/components/ui/badge';
import { BarOnly } from '~/components/navigation/page-header';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ForwardChevron } from '~/components/ui/icons';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { recentJobs, useListOwner, viewedFrom } from '~/features/jobs/recent';
import { ShareCardSheet } from './share-card';
import { useAppliedJobIds } from '~/features/jobs/marks';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useShrinkingTabBar } from '~/features/tab-bar';
import { callAction } from '~/lib/api';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { useHasBoard } from '~/lib/use-tabs';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
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
  const tCompanies = useTranslations('companies');
  const tLanding = useTranslations('landing');
  const tApply = useTranslations('apply');
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
  const hasBoard = useHasBoard();
  // Like it, and not already applied to: those are done with, as Home's suggestions leave them out.
  const similarApplied = useAppliedJobIds(similar.map((item) => item.id));
  const similarShown = withoutHidden(similar, useHiddenCompanies()).filter((item) => !similarApplied.has(item.id));

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
  }, [open, job.slug]);

  const shareLink = () => {
    const url = withShareSource(`${env.siteUrl}/jobs/${job.slug}`);
    // `url` is iOS's alone: Android shares the message, so there the link goes inside it.
    Share.share(Platform.OS === 'ios' ? { message: title, url } : { message: `${title}\n${url}` }).catch(() => {});
  };
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
              <Button
                label={t('share')}
                variant="ghost"
                size="sm"
                icon={<Share2 size={16} color={colors.foreground} />}
                // The bar does not grow with the text: capped as the bell's count is.
                maxFontSizeMultiplier={1.4}
                onPress={share}
              />
            </BarOnly>
          ),
        }}
      />
      {card.mounted ? <ShareCardSheet job={job} visible={card.open} onClose={card.hide} onDismiss={card.onDismiss} /> : null}
      <ScrollView
        {...shrink}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[6] }}
      >
        <HiddenNotice companyId={job.company.id} />

        {open ? null : (
          <Notice tone="warning" title={t('expired')} icon={<CalendarX2 size={16} color={colors.warning} />}>
            {t('expiredBody')}
          </Notice>
        )}

        <View style={{ gap: space[4] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <CompanyLogo name={companyName} logoUrl={job.company.logo_url} seed={job.company.slug} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[2], rowGap: 2 }}>
                <Text
                  variant="small"
                  weight="semibold"
                  tone="primary"
                  accessibilityRole="link"
                  onPress={() => router.push({ pathname: '/companies/[slug]', params: { slug: job.company.slug } })}
                >
                  {companyName}
                </Text>
                {job.company.verification_status === 'verified' ? (
                  <VerifiedMark>
                    <Badge variant="accent" label={tCompanies('verified')} icon={<BadgeCheck size={12} color={colors.accentForeground} />} />
                  </VerifiedMark>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MapPin size={13} color={colors.mutedForeground} />
                <Text variant="small" tone="mutedForeground">
                  {districtName}
                </Text>
              </View>
            </View>
          </View>

          <Text variant="title" weight="bold" accessibilityRole="header">
            {title}
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Fact>{tTrack(job.track)}</Fact>
            <Fact>{tType(job.employment_type)}</Fact>
            <Fact icon={<Users size={13} color={colors.mutedForeground} />}>{tExp(job.experience_band)}</Fact>
            <Fact>{`${formatNumber(job.seats, locale)} ${t('seatsLabel', { count: job.seats })}`}</Fact>
          </View>

          <Pressable
            accessibilityRole="link"
            onPress={() =>
              router.push({ pathname: '/jobs/[slug]', params: { slug: buildLandingSlug(job.track, job.district.slug) } })
            }
            hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
          >
            <Text variant="small" weight="medium" tone="primary">
              {tLanding('title', { track: tTrack(job.track), district: districtName })}
            </Text>
            <ForwardChevron size={14} color={colors.primary} />
          </Pressable>
        </View>

        <CompensationCard job={job} reference={reference} />

        {/* The next step. Applying arrives with sign-in; until then, and for
            anyone the button cannot work for, the page says what is true. */}
        {!open ? (
          <Card style={{ gap: space[3] }}>
            <Text variant="small" tone="mutedForeground">
              {job.expires_at ? t('closedOn', { date: formatDate(job.expires_at, locale) }) : t('closedCtaBody')}
            </Text>
            {hasBoard ? <Button label={t('browseOpen')} onPress={() => router.navigate('/jobs')} /> : null}
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
            <Button label={tApply('viewApplications')} variant="outline" onPress={() => router.navigate('/dashboard/applications')} />
          </Card>
        ) : isCandidate(actor) && !isApproved(actor) ? (
          // The database would refuse the application; say why before the form.
          <Card style={{ gap: space[1] }}>
            <Text weight="semibold">{tApply('suspendedTitle')}</Text>
            <Text variant="small" tone="mutedForeground">
              {tApply('suspendedBody')}
            </Text>
          </Card>
        ) : (
          <Button
            label={t('apply')}
            size="lg"
            onPress={() =>
              session
                ? router.push({ pathname: '/jobs/[slug]/apply', params: { slug: job.slug } })
                : router.push({ pathname: '/sign-in', params: { next: `/jobs/${job.slug}/apply` } })
            }
          />
        )}

        {/* A bookmark is a candidate's; somebody signed out is sent to sign in. */}
        <SaveJobButton jobId={job.id} slug={job.slug} />

        <Section title={t('description')}>
          <Text selectable>{description}</Text>
        </Section>

        {job.requirements_ar ? (
          <Section title={t('requirements')}>
            <Text selectable>{job.requirements_ar}</Text>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Eye size={13} color={colors.mutedForeground} />
            <Text variant="caption" tone="mutedForeground">
              {t('views', { count: job.view_count })}
            </Text>
          </View>
        </View>

        <Card style={{ gap: space[3], padding: space[5] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Building2 size={16} color={colors.mutedForeground} />
            <Text variant="label" weight="semibold" tone="mutedForeground" accessibilityRole="header">
              {t('aboutCompany')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <CompanyLogo name={companyName} logoUrl={job.company.logo_url} seed={job.company.slug} size="sm" />
            <Text variant="headline" weight="semibold" style={{ flex: 1 }}>
              {companyName}
            </Text>
          </View>
          {job.company.verification_status === 'verified' ? (
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <BadgeCheck size={16} color={colors.gold} style={{ marginTop: 4 }} />
              <Text variant="small" tone="mutedForeground" style={{ flex: 1 }}>
                {t('verifiedMeaning')}
              </Text>
            </View>
          ) : null}
          {job.company.about_ar || job.company.about_en ? (
            <Text variant="small" tone="mutedForeground">
              {localized(locale, job.company.about_ar, job.company.about_en)}
            </Text>
          ) : null}
          <Button
            label={t('companyPage')}
            variant="outline"
            onPress={() => router.push({ pathname: '/companies/[slug]', params: { slug: job.company.slug } })}
          />
        </Card>

        {similarShown.length ? (
          <Section title={t('similarJobs')}>
            <View style={{ gap: space[2] }}>
              {similarShown.map((item) => (
                <JobCard key={item.id} job={item} />
              ))}
            </View>
          </Section>
        ) : null}

        <View style={{ alignItems: 'flex-start' }}>
          <ReportButton target="job" targetId={job.id} returnPath={`/jobs/${job.slug}`} label={t('report')} />
        </View>
      </ScrollView>
    </>
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
function Fact({ icon, children }: { icon?: React.ReactNode; children: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: space[3],
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
