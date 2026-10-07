import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { BadgeCheck, Globe, MapPin, Users } from '~/components/ui/lucide';
import { localized } from '@/lib/locale';
import { safeHttpUrl } from '@/lib/security/sanitize';
import { CompanyLogo } from '~/components/companies/company-logo';
import { JobCard } from '~/components/jobs/job-card';
import { HiddenNotice, HideCompany } from '~/components/moderation/hide-company';
import { ReportButton } from '~/components/moderation/report';
import { FollowCompanyButton, useOffersFollow } from '~/components/saved/save-controls';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useCompany } from '~/features/companies/queries';
import { useShrinkingTabBar } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { ApiError } from '~/lib/api';
import { useHasBoard } from '~/lib/use-tabs';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { usePullRefresh } from '~/lib/use-pull-refresh';

/**
 * A company's page — the website's /companies/<slug>: who they are, where,
 * how many people, their site, what they say about themselves, and their
 * newest open roles with the way to all of them on the board.
 */
export default function CompanyScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = typeof raw === 'string' ? raw.toLowerCase() : '';
  const locale = useLocale();
  const t = useTranslations('companies');
  const offersFollow = useOffersFollow();
  const { colors, shadow } = useTheme();
  const page = useCompany(slug);
  const pull = usePullRefresh(() => page.refetch());
  const hasBoard = useHasBoard();
  const shrink = useShrinkingTabBar();

  if (page.isPending) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <LoadingState />
      </>
    );
  }

  if (page.isError && !page.data) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        {page.error instanceof ApiError && page.error.status === 404 ? (
          <NotFoundState />
        ) : (
          <ErrorState error={page.error} onRetry={() => page.refetch()} />
        )}
      </>
    );
  }

  const { company, jobs, total } = page.data;
  const name = localized(locale, company.name_ar, company.name_en);
  const about = localized(locale, company.about_ar, company.about_en);
  // Opened only when it parses as http(s): a row written before the column was
  // checked on the way in could still hold something else.
  const website = safeHttpUrl(company.website);

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView
        {...shrink}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[6] }}
      >
        <HiddenNotice companyId={company.id} />

        <View style={{ gap: space[4] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
            <CompanyLogo name={name} logoUrl={company.logo_url} seed={company.slug} size="lg" />
            <View style={{ flex: 1, gap: space[2] }}>
              <Text variant="title" weight="bold" accessibilityRole="header">
                {name}
              </Text>
              {company.verification_status === 'verified' ? (
                <Badge variant="accent" label={t('verified')} icon={<BadgeCheck size={12} color={colors.accentForeground} />} />
              ) : null}
            </View>
          </View>
          {/* Nothing to state, no card: an empty one read as something missing. */}
          {company.district || company.headcount_band || website ? (
            <View
              style={{
                ...corner('xl'),
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: colors.border,
                backgroundColor: colors.card,
                boxShadow: shadow.card,
                paddingHorizontal: space[4],
                paddingVertical: space[2],
              }}
            >
              {company.district ? (
                <Fact icon={<MapPin size={15} color={colors.mutedForeground} />} label={t('location')}>
                  {localized(locale, company.district.name_ar, company.district.name_en)}
                </Fact>
              ) : null}
              {company.headcount_band ? (
                <Fact icon={<Users size={15} color={colors.mutedForeground} />} label={t('headcount')}>
                  {t(`headcountBand.${company.headcount_band}`)}
                </Fact>
              ) : null}
              {website ? (
                <Fact
                  icon={<Globe size={15} color={colors.mutedForeground} />}
                  label={t('website')}
                  onPress={() => Linking.openURL(website).catch(() => {})}
                >
                  {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </Fact>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Tell me when this brokerage posts — a candidate's, or the way into an account. */}
        <FollowCompanyButton slug={company.slug} label={name} />

        {about ? (
          <View style={{ gap: space[2] }}>
            <Text variant="headline" weight="semibold" accessibilityRole="header">
              {t('about')}
            </Text>
            <Text selectable>{about}</Text>
          </View>
        ) : null}

        <View style={{ gap: space[3] }}>
          <Text variant="headline" weight="semibold" accessibilityRole="header">
            {t('openRoles', { count: total })}
          </Text>
          {jobs.length ? (
            <View style={{ gap: space[2] }}>
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </View>
          ) : (
            <View
              style={{
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderStyle: 'dashed',
                borderColor: colors.border,
                ...corner('xl'),
                padding: space[6],
              }}
            >
              <Text tone="mutedForeground" style={{ textAlign: 'center' }}>
                {t('noOpenRoles', { follow: offersFollow ? 'yes' : 'no' })}
              </Text>
            </View>
          )}
          {total > jobs.length && hasBoard ? (
            <Button
              variant="outline"
              label={t.markup('seeAllRoles', { count: total, ...markupTags })}
              onPress={() => router.navigate({ pathname: '/jobs', params: { company: company.slug } })}
            />
          ) : null}
        </View>

        <View
          style={{
            alignItems: 'flex-start',
            gap: space[1],
            paddingTop: space[4],
            borderTopWidth: StyleSheet.hairlineWidth * 2,
            borderTopColor: colors.border,
          }}
        >
          <ReportButton target="company" targetId={company.id} returnPath={`/companies/${company.slug}`} label={t('report')} />
          <HideCompany companyId={company.id} companyName={name} companySlug={company.slug} />
        </View>
      </ScrollView>
    </>
  );
}

function Fact({
  icon,
  label,
  children,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  children: string;
  onPress?: () => void;
}) {
  // The value wraps under its label when the two do not fit side by side, at
  // the larger text sizes: beside it, it was squeezed to nothing. The label is
  // read as part of the value, once.
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[3], rowGap: 2, minHeight: 40, paddingVertical: space[1] }}>
      {icon}
      <Text variant="small" tone="mutedForeground" accessible={false} style={{ minWidth: 72, flexShrink: 1 }}>
        {label}
      </Text>
      <Text
        variant="small"
        weight="medium"
        tone={onPress ? 'primary' : 'foreground'}
        accessibilityLabel={`${label}: ${children}`}
        accessibilityRole={onPress ? 'link' : undefined}
        onPress={onPress}
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160 }}
      >
        {children}
      </Text>
    </View>
  );
}
