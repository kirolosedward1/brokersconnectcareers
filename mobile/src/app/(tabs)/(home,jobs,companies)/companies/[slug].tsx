import { Linking, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { BadgeCheck, Globe, MapPin, Users } from 'lucide-react-native';
import { localized } from '@/lib/locale';
import { safeHttpUrl } from '@/lib/security/sanitize';
import { CompanyLogo } from '~/components/companies/company-logo';
import { JobCard } from '~/components/jobs/job-card';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useCompany } from '~/features/companies/queries';
import { markupTags } from '~/i18n/rich';
import { ApiError } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

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
  const tJobs = useTranslations('jobs');
  const { colors } = useTheme();
  const page = useCompany(slug);

  if (page.isPending) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <LoadingState />
      </>
    );
  }

  if (page.isError) {
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
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={page.isRefetching} onRefresh={() => page.refetch()} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
      >
        <View style={{ flexDirection: 'row', gap: space[4] }}>
          <CompanyLogo name={name} logoUrl={company.logo_url} seed={company.slug} size="lg" />
          <View style={{ flex: 1, gap: space[2] }}>
            <Text variant="title" weight="bold" accessibilityRole="header">
              {name}
            </Text>
            {company.verification_status === 'verified' ? (
              <Badge variant="success" label={t('verified')} icon={<BadgeCheck size={12} color={colors.success} />} />
            ) : null}
            <View style={{ gap: space[1] }}>
              {company.district ? (
                <Fact icon={<MapPin size={14} color={colors.mutedForeground} />} label={t('location')}>
                  {localized(locale, company.district.name_ar, company.district.name_en)}
                </Fact>
              ) : null}
              {company.headcount_band ? (
                <Fact icon={<Users size={14} color={colors.mutedForeground} />} label={t('headcount')}>
                  {t(`headcountBand.${company.headcount_band}`)}
                </Fact>
              ) : null}
              {website ? (
                <Fact
                  icon={<Globe size={14} color={colors.mutedForeground} />}
                  label={t('website')}
                  onPress={() => Linking.openURL(website).catch(() => {})}
                >
                  {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </Fact>
              ) : null}
            </View>
          </View>
        </View>

        {about ? (
          <View style={{ gap: space[2] }}>
            <Text weight="semibold" accessibilityRole="header">
              {t('about')}
            </Text>
            <Text selectable>{about}</Text>
          </View>
        ) : null}

        <View style={{ gap: space[3] }}>
          <Text weight="semibold" accessibilityRole="header">
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
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.border,
                borderRadius: radius.xl,
                padding: space[6],
              }}
            >
              <Text tone="mutedForeground" style={{ textAlign: 'center' }}>
                {tJobs('empty')}
              </Text>
            </View>
          )}
          {total > jobs.length ? (
            <Button
              variant="outline"
              label={t.markup('seeAllRoles', { count: total, ...markupTags })}
              onPress={() => router.navigate({ pathname: '/jobs', params: { company: company.slug } })}
            />
          ) : null}
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
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
      {icon}
      <Text
        variant="small"
        tone={onPress ? 'primary' : 'mutedForeground'}
        accessibilityLabel={`${label}: ${children}`}
        accessibilityRole={onPress ? 'link' : undefined}
        onPress={onPress}
        style={{ flexShrink: 1 }}
      >
        {children}
      </Text>
    </View>
  );
}
