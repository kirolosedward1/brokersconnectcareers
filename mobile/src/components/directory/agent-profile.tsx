import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Lock, MapPin, ShieldCheck, UserRound } from 'lucide-react-native';
import { localized } from '@/lib/locale';
import { canShortlistAgents, canViewAgentProfile } from '@/lib/permissions';
import type { DistrictRow } from '@/lib/supabase/database.types';
import { AgentCv } from '~/components/directory/agent-cv';
import { ContactReveal, CvButton } from '~/components/directory/contact-reveal';
import { ShortlistButton } from '~/components/directory/shortlist-controls';
import { ReportButton } from '~/components/moderation/report';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { recordAgentView, useAgentPage } from '~/features/directory/queries';
import { useDevelopers, useDistricts } from '~/features/taxonomy';
import { routeInside } from '~/lib/links';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

/**
 * One consultant's page — the website's /agents/<slug>, for the directory's
 * readers and for the consultant it belongs to, previewing what companies see.
 *
 * get_agent_card() answers only those two, so a card arriving is most of the
 * permission; canViewAgentProfile asks the rest with the owner known. No
 * number and no CV link on the page until somebody asks (ContactReveal); the
 * shortlist only for a company, on an open card; the owner is told which
 * audience sees what, by their visibility setting. A company's look is
 * recorded (record_agent_view decides whether it counts); the owner's is not.
 */
export function AgentProfile({ handle }: { handle: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { session, viewer, actor } = useSession();
  const page = useAgentPage(handle);
  const districts = useDistricts().data;
  const developers = useDevelopers().data;
  const districtMap = useMemo(() => new Map((districts ?? []).map((row) => [row.id, row])), [districts]);

  const card = page.data?.card ?? null;
  const about = page.data?.about ?? null;
  const hasCompany = Boolean(viewer?.company);

  // Once per page opened, by a company; the owner's own preview is never counted.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (!card || !hasCompany || counted.current === card.slug) return;
    counted.current = card.slug;
    recordAgentView(card.slug);
  }, [card, hasCompany]);

  const header = <Stack.Screen options={{ title: '' }} />;

  if (!session || page.isPending) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    );
  }
  if (page.isError && !page.data) {
    return (
      <>
        {header}
        <ErrorState error={page.error} onRetry={() => page.refetch()} />
      </>
    );
  }
  if (!card || !canViewAgentProfile(actor, { user_id: about?.user_id ?? null })) {
    return (
      <>
        {header}
        <NotFoundState />
      </>
    );
  }

  const isOwner = Boolean(about?.user_id && about.user_id === session.user.id);
  const name = card.is_unlocked && card.full_name ? card.full_name : t('agents.anonymous');
  const headline = localized(locale, card.headline_ar, card.headline_en);
  const canReveal = card.can_reveal && !isOwner;
  const canShortlist = canShortlistAgents(actor) && card.is_unlocked && !isOwner;
  const areas = card.district_ids
    .map((id) => districtMap.get(id))
    .filter((district): district is DistrictRow => Boolean(district));
  const soldFor = (developers ?? []).filter((developer) => card.developer_ids.includes(developer.id));
  const summary = about ? localized(locale, about.summary_ar, about.summary_en) : '';

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={page.isRefetching} onRefresh={() => page.refetch()} tintColor={colors.primary} />
        }
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
      >
        {/* The owner sees everything; what they need to know is what everybody else sees. */}
        {isOwner ? (
          <View
            style={{
              gap: space[1],
              padding: space[4],
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: colors.primary,
              backgroundColor: colors.secondary,
            }}
          >
            <Text variant="small" weight="semibold">
              {t('agents.ownerBanner')}
            </Text>
            <Text variant="small" tone="mutedForeground">
              {about?.visibility === 'public'
                ? t('agents.ownerPublic')
                : about?.visibility === 'hidden'
                  ? t('agents.ownerHidden')
                  : t('agents.ownerVerified')}
            </Text>
            <Text
              variant="small"
              weight="medium"
              tone="primary"
              accessibilityRole="link"
              onPress={() => router.dismissTo('/account/profile')}
              style={{ marginTop: space[1] }}
            >
              {t('agents.ownerEdit')}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[4] }}>
          {card.is_unlocked ? (
            <Avatar name={card.full_name ?? ''} src={card.avatar_url} seed={card.slug} size="lg" />
          ) : (
            <View
              accessible={false}
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.muted,
              }}
            >
              <UserRound size={28} color={colors.mutedForeground} />
            </View>
          )}
          <View style={{ flex: 1, gap: space[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <Text variant="title" weight="bold" accessibilityRole="header" style={{ flexShrink: 1 }}>
                {name}
              </Text>
              {card.is_unlocked ? null : (
                <View accessible accessibilityLabel={t('agents.locked')}>
                  <Lock size={16} color={colors.mutedForeground} />
                </View>
              )}
            </View>
            {headline ? <Text tone="mutedForeground">{headline}</Text> : null}
            <Text variant="small" tone="mutedForeground">
              {t('agents.yearsExperience', { count: card.years_experience })}
            </Text>
          </View>
        </View>

        {card.is_unlocked ? (
          canReveal || (isOwner && card.has_cv) || canShortlist ? (
            <View style={{ gap: space[3] }}>
              {canReveal ? <ContactReveal handle={card.slug} hasCv={card.has_cv} /> : null}
              {isOwner && card.has_cv ? <CvButton handle={card.slug} /> : null}
              {canShortlist ? (
                <View style={{ alignItems: 'flex-start' }}>
                  <ShortlistButton agentId={card.id} />
                </View>
              ) : null}
            </View>
          ) : null
        ) : (
          // Locked to this company: why, and the way to open it.
          <View
            style={{
              gap: space[3],
              padding: space[4],
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: colors.primary,
              backgroundColor: colors.secondary,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <ShieldCheck size={18} color={colors.primary} />
              <Text weight="medium" style={{ flexShrink: 1 }}>
                {t('agents.locked')}
              </Text>
            </View>
            <Text variant="small" tone="mutedForeground">
              {t('agents.lockedBody')}
            </Text>
            <View style={{ alignItems: 'flex-start' }}>
              <Button label={t('agents.lockedCta')} onPress={() => router.navigate(routeInside('/employer/company', actor) as never)} />
            </View>
          </View>
        )}

        <View style={{ gap: space[5] }}>
          <Fact title={t('agents.availability')}>
            <Badge variant="primary" label={t(`availability.${card.availability}`)} />
          </Fact>
          {card.tracks.length ? (
            <Fact title={t('agents.tracks')}>
              {card.tracks.map((track) => (
                <Badge key={track} variant="outline" label={t(`track.${track}`)} />
              ))}
            </Fact>
          ) : null}
          {areas.length ? (
            <Fact title={t('agents.districts')}>
              {areas.map((district) => (
                <Badge
                  key={district.id}
                  variant="outline"
                  icon={<MapPin size={12} color={colors.mutedForeground} />}
                  label={localized(locale, district.name_ar, district.name_en)}
                />
              ))}
            </Fact>
          ) : null}
          {soldFor.length ? (
            <Fact title={t('agents.soldFor')}>
              {soldFor.map((developer) => (
                <Badge key={developer.id} variant="outline" label={localized(locale, developer.name_ar, developer.name_en)} />
              ))}
            </Fact>
          ) : null}
          {card.languages.length ? (
            <Fact title={t('agents.languages')}>
              {card.languages.map((language) => (
                <Badge key={language} variant="outline" label={t(`language.${language}` as never)} />
              ))}
            </Fact>
          ) : null}
        </View>

        <AgentCv
          summary={summary || null}
          unitsClosed={about?.units_closed ?? null}
          volumeEgp={about?.volume_egp ?? null}
          sections={page.data?.cv ?? { experience: [], education: [], certifications: [] }}
          districts={districtMap}
        />

        {/* Impersonation is the report a directory of people most needs to hear. */}
        {isOwner ? null : (
          <View style={{ alignItems: 'flex-start', paddingTop: space[4], borderTopWidth: 1, borderTopColor: colors.border }}>
            <ReportButton target="agent" targetId={card.id} returnPath={`/agents/${card.slug}`} label={t('agents.report')} />
          </View>
        )}
      </ScrollView>
    </>
  );
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="small" weight="semibold" accessibilityRole="header">
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>{children}</View>
    </View>
  );
}
