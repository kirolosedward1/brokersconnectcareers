import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { ReportStatus } from '@/lib/supabase/database.types';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, ApprovalBadge, Fact, SectionTitle } from '~/components/admin/kit';
import { Record } from '~/components/admin/record';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ForwardChevron } from '~/components/ui/icons';
import { ExternalLink, RotateCcw, ShieldAlert } from '~/components/ui/lucide';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { UUID, useAgentFile, visibilityVariant, type AgentFile } from '~/features/admin/agents';
import { useDevelopers, useDistricts } from '~/features/taxonomy';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { useMoney } from '~/features/money';

/** The website's ReportStatusBadge: red open, amber under investigation, green resolved, plain dismissed. */
const REPORT_VARIANT: Record<ReportStatus, 'destructive' | 'warning' | 'success' | 'default'> = {
  open: 'destructive',
  investigating: 'warning',
  resolved: 'success',
  dismissed: 'default',
};

/**
 * One consultant profile and the one lever over it — the website's
 * /admin/agents/<id>. Restricting hides the profile from the directory and
 * from every employer until an admin lifts it, and the consultant's own saves
 * cannot undo it (migration 317). The CV is not here: whether one was
 * uploaded is a fact of the profile, the file is the consultant's, served by
 * the directory's own rules — an impersonation case is settled on the profile
 * and the reports, not the document. The owner's phone and email are on the
 * account's file, behind a reason.
 */
export default function AdminAgentScreen() {
  const t = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.agentProfile') }} />
      <AdminGate>
        <Profile id={typeof id === 'string' && UUID.test(id) ? id : undefined} />
      </AdminGate>
    </>
  );
}

function Profile({ id }: { id: string | undefined }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const file = useAgentFile(id);
  const pull = usePullRefresh(() => file.refetch());

  if (!id) return <NotFoundState />;
  if (file.isPending) return <LoadingState />;
  if (file.isError && !file.data) return <ErrorState error={file.error} onRetry={() => file.refetch()} />;
  const agent = file.data;
  if (!agent) return <NotFoundState />;

  const restricted = Boolean(agent.restricted_at);
  const headline = agent.headline_ar;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[5] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
        <Avatar name={agent.profile.full_name} src={agent.profile.avatar_url} size="lg" />
        <View style={{ flex: 1, gap: space[1] }}>
          <Text variant="title" weight="semibold" accessibilityRole="header">
            {agent.profile.full_name}
          </Text>
          {headline ? (
            <Text variant="small" tone="mutedForeground">
              {headline}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
            <Badge
              variant={visibilityVariant(agent.visibility, restricted)}
              label={restricted ? t('admin.restricted') : t(`visibility.${agent.visibility}`)}
            />
          </View>
        </View>
      </View>

      {restricted ? (
        <View accessibilityRole="alert" style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.destructiveMuted }}>
          <Text variant="small" tone="destructive">
            {t('admin.agentRestrictedBanner', { date: formatDate(agent.restricted_at as string, locale) })}
            {agent.restriction_reason ? ` «${agent.restriction_reason}»` : ''}
          </Text>
        </View>
      ) : null}

      <Levers agent={agent} />

      <Card style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.owner')}</SectionTitle>
        <LinkRow
          label={agent.profile.full_name}
          onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: agent.profile.id } })}
        >
          <Text weight="medium" tone="primary">
            {agent.profile.full_name}
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <ApprovalBadge status={agent.profile.approval_status} />
          </View>
        </LinkRow>
        <Text variant="caption" tone="mutedForeground">
          {t('admin.contactOnAccount')}
        </Text>
      </Card>

      <Facts agent={agent} />

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.reportsAboutProfile')}</SectionTitle>
        {agent.reports.length === 0 ? (
          <Text variant="small" tone="mutedForeground">
            {t('admin.noReports')}
          </Text>
        ) : (
          agent.reports.map((report) => (
            <View key={report.id} style={{ gap: 2, padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
                <Text variant="small" weight="medium" style={{ flex: 1 }}>
                  {t(`reportReason.${report.reason}`)}
                </Text>
                <Badge variant={REPORT_VARIANT[report.status]} label={t(`admin.reportStatus.${report.status}`)} />
              </View>
              {report.detail ? (
                <Text variant="small" tone="mutedForeground">
                  {report.detail}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] }}>
                {report.reporter ? (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={report.reporter.full_name}
                    onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: report.reporter?.id ?? '' } })}
                    hitSlop={8}
                  >
                    <Text variant="caption" tone="primary">
                      {report.reporter.full_name}
                    </Text>
                  </Pressable>
                ) : (
                  <Text variant="caption" tone="mutedForeground">
                    {t('admin.unknownActor')}
                  </Text>
                )}
                <Text variant="caption" tone="mutedForeground">{` · ${formatDate(report.created_at, locale)}`}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Record targetType="agent" targetId={agent.id} />
    </ScrollView>
  );
}

/** A row that opens another screen of the console. */
function LinkRow({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>{children}</View>
      <ForwardChevron size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

/**
 * The profile as the directory would show it, with the ids resolved to names
 * (districts and developers are the app's own taxonomies, kept across
 * launches), and the public page where there is one: not for a restricted
 * profile, nor a hidden one, which the directory would refuse to show.
 */
function Facts({ agent }: { agent: AgentFile }) {
  const t = useTranslations();
  const money = useMoney();
  const locale = useLocale();
  const { colors } = useTheme();
  const districts = useDistricts().data ?? [];
  const developers = useDevelopers().data ?? [];
  const restricted = Boolean(agent.restricted_at);

  const names = (ids: number[], rows: { id: number; name_ar: string; name_en: string }[]) =>
    ids
      .map((id) => rows.find((row) => row.id === id))
      .filter((row): row is { id: number; name_ar: string; name_en: string } => Boolean(row))
      .map((row) => localized(locale, row.name_ar, row.name_en));
  const language = (code: string) => (t.has(`language.${code}` as never) ? t(`language.${code}` as never) : code);

  return (
    <Card style={{ gap: space[4] }}>
      <SectionTitle>{t('admin.agentProfile')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[3], columnGap: space[4] }}>
        <Fact label={t('admin.colSlug')}>
          {/* The slug as written, left to right, and copyable. */}
          <Text variant="small" selectable style={{ writingDirection: 'ltr', textAlign: 'left' }}>
            {agent.slug}
          </Text>
        </Fact>
        <Fact label={t('admin.colYears')}>{t('admin.yearsN', { count: agent.years_experience })}</Fact>
        <Fact label={t('admin.track')}>{formatList(agent.tracks.map((track) => t(`track.${track}`)), locale) || '—'}</Fact>
        <Fact label={t('admin.district')}>{formatList(names(agent.district_ids, districts), locale) || '—'}</Fact>
        <Fact label={t('agents.soldFor')}>{formatList(names(agent.developer_ids, developers), locale) || '—'}</Fact>
        <Fact label={t('admin.languages')}>{formatList(agent.languages.map(language), locale) || '—'}</Fact>
        <Fact label={t('admin.colAvailability')}>{t(`availability.${agent.availability}`)}</Fact>
        <Fact label={t('admin.colVisibility')}>{t(`visibility.${agent.visibility}`)}</Fact>
        <Fact label={t('admin.unitsClosed')}>{agent.units_closed != null ? formatNumber(agent.units_closed, locale) : '—'}</Fact>
        <Fact label={t('admin.volumeClosed')}>
          {agent.volume_egp != null ? money.amount(agent.volume_egp) : '—'}
        </Fact>
        <Fact label={t('admin.hasCv')}>{agent.has_cv ? t('admin.yes') : t('admin.no')}</Fact>
        <Fact label={t('admin.colJoined')}>{formatDate(agent.created_at, locale)}</Fact>
      </View>
      {/* The Arabic headline is the lede under the name, as on the website; the English one, where there is one, is here. */}
      {agent.headline_en ? <Fact label={t('agents.headlineEn')}>{agent.headline_en}</Fact> : null}
      {agent.summary_ar ? (
        <Text variant="small" tone="mutedForeground" selectable>
          {agent.summary_ar}
        </Text>
      ) : null}
      {!restricted && agent.visibility !== 'hidden' ? (
        <Button
          label={t('admin.publicPage')}
          variant="outline"
          size="sm"
          icon={<ExternalLink size={16} color={colors.foreground} />}
          onPress={() => router.push({ pathname: '/agents/[slug]', params: { slug: agent.slug } })}
        />
      ) : null}
    </Card>
  );
}

/**
 * The one lever, as the website's aside offers it: restricting a profile
 * that is not restricted (the consultant is told why), lifting the
 * restriction on one that is (the reason stays on the record; the profile
 * stays hidden until the consultant chooses to be seen again).
 */
function Levers({ agent }: { agent: AgentFile }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const restricted = Boolean(agent.restricted_at);
  return (
    <Card style={{ gap: space[3] }}>
      <SectionTitle>{t('admin.actions')}</SectionTitle>
      {restricted ? (
        <Button
          label={t('admin.liftRestriction')}
          variant="outline"
          icon={<RotateCcw size={18} color={colors.success} />}
          onPress={() =>
            openDecision({
              lever: { do: 'restriction', agentId: agent.id, restrict: false },
              title: t('admin.liftRestriction'),
              body: t('admin.liftRestrictionBody'),
              confirmLabel: t('admin.liftRestriction'),
              reason: 'required',
            })
          }
        />
      ) : (
        <Button
          label={t('admin.restrictProfile')}
          variant="ghost"
          icon={<ShieldAlert size={18} color={colors.destructive} />}
          onPress={() =>
            openDecision({
              lever: { do: 'restriction', agentId: agent.id, restrict: true },
              title: t('admin.restrictProfile'),
              body: t('admin.restrictProfileBody'),
              confirmLabel: t('admin.restrictProfile'),
              destructive: true,
              reason: 'required',
              reasonLabel: t('admin.reasonToConsultant'),
            })
          }
        />
      )}
    </Card>
  );
}
