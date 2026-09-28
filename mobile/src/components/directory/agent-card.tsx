import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Briefcase, CircleDot, Lock, MapPin, UserRound } from 'lucide-react-native';
import { formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { AgentCardRow, DistrictRow, JobTrack } from '@/lib/supabase/database.types';
import { ShortlistIcon, useShortlistToggle } from '~/components/directory/shortlist-controls';
import { Avatar } from '~/components/ui/avatar';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

/**
 * A directory card — the website's AgentCard: anonymised until the company is
 * verified. An unverified company sees experience, tracks and areas, enough to
 * judge whether somebody is worth verifying for, and no name, no photo and no
 * way to make contact; the database decides that, and the card only draws
 * either side of it honestly. A locked card is opened by its id, which is
 * what the search hands back in place of a slug that would spell the name.
 *
 * Identity on top, then the three things an employer scans a directory for —
 * how experienced, where, and whether they are looking — on one line in the
 * same place on every card.
 */
export function AgentCard({
  agent,
  districts,
  shortlistable,
}: {
  agent: AgentCardRow;
  districts: Map<number, DistrictRow>;
  /** A company to keep them in, and an open card: migration 60's insert policy, offered where it can work. */
  shortlistable: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const shortlist = useShortlistToggle(agent.id);

  const name = agent.is_unlocked && agent.full_name ? agent.full_name : t('agents.anonymous');
  const headline = localized(locale, agent.headline_ar, agent.headline_en);
  const areaText = areaLine(agent.district_ids, districts, locale);
  const years = t('agents.yearsExperience', { count: agent.years_experience });
  const availability = t(`availability.${agent.availability}`);
  const looking = agent.availability === 'actively_searching';

  return (
    <Card
      onPress={() => router.push({ pathname: '/agents/[slug]', params: { slug: agent.slug } })}
      accessibilityLabel={formatList(
        [name, agent.is_unlocked ? null : t('agents.locked'), headline || null, years, areaText, availability].filter(
          (part): part is string => Boolean(part),
        ),
        locale,
      )}
      accessibilityActions={shortlistable ? [{ name: 'shortlist', label: shortlist.label }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'shortlist') shortlist.toggle();
      }}
      style={{ gap: space[3] }}
    >
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        {agent.is_unlocked ? (
          <Avatar name={agent.full_name ?? ''} src={agent.avatar_url} seed={agent.slug} size="md" />
        ) : (
          <Silhouette />
        )}

        <View style={{ flex: 1, gap: space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Text weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Text>
            {agent.is_unlocked ? null : <Lock size={14} color={colors.mutedForeground} />}
          </View>
          {headline ? (
            <Text variant="small" tone="mutedForeground" numberOfLines={2}>
              {headline}
            </Text>
          ) : null}
          <TrackPills tracks={agent.tracks} />
        </View>

        {shortlistable ? <ShortlistIcon shortlist={shortlist} /> : null}
      </View>

      <CardFacts years={years} areas={areaText} availability={availability} looking={looking} />
    </Card>
  );
}

/** Where a photo would be on a card that may not show one: an initial is more than an anonymous card may say. */
export function Silhouette() {
  const { colors } = useTheme();
  return (
    <View
      accessible={false}
      style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}
    >
      <UserRound size={20} color={colors.mutedForeground} />
    </View>
  );
}

/** The first three tracks, as the website's pills. */
export function TrackPills({ tracks }: { tracks: readonly JobTrack[] | null }) {
  const t = useTranslations('track');
  const { colors } = useTheme();
  if (!tracks?.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginTop: space[1] }}>
      {tracks.slice(0, 3).map((track) => (
        <View
          key={track}
          style={{ paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.full, backgroundColor: colors.secondary }}
        >
          <Text variant="caption" weight="medium" tone="primary">
            {t(track)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The line under the rule: experience, areas, whether they are looking — and
 * anything the list adds (the shortlist says who kept them). Availability is
 * green only when it is the answer somebody hopes for.
 */
export function CardFacts({
  years,
  areas,
  availability,
  looking,
  children,
}: {
  years: string | null;
  areas: string | null;
  availability: string | null;
  looking: boolean;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: space[4],
        rowGap: space[1],
        paddingTop: space[3],
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      {years ? <Fact icon={<Briefcase size={14} color={colors.mutedForeground} />} text={years} /> : null}
      {areas ? <Fact icon={<MapPin size={14} color={colors.mutedForeground} />} text={areas} /> : null}
      {availability ? (
        <Fact
          icon={<CircleDot size={14} color={looking ? colors.success : colors.mutedForeground} />}
          text={availability}
          tone={looking ? 'success' : 'mutedForeground'}
        />
      ) : null}
      {children}
    </View>
  );
}

/** Up to two areas and how many more — the website's card line. */
export function areaLine(districtIds: readonly number[] | null, districts: Map<number, DistrictRow>, locale: string): string | null {
  const ids = districtIds ?? [];
  const areas = ids
    .map((id) => districts.get(id))
    .filter((district): district is DistrictRow => Boolean(district))
    .slice(0, 2);
  if (!areas.length) return null;
  const more = ids.length - areas.length;
  const names = formatList(areas.map((district) => localized(locale, district.name_ar, district.name_en)), locale);
  return more > 0 ? `${names} +${formatNumber(more, locale)}` : names;
}

function Fact({
  icon,
  text,
  tone = 'mutedForeground',
}: {
  icon: ReactNode;
  text: string;
  tone?: 'success' | 'mutedForeground';
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
      {icon}
      <Text variant="small" tone={tone} weight={tone === 'success' ? 'medium' : 'regular'}>
        {text}
      </Text>
    </View>
  );
}
