import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Bell, BellOff, Building2, Search, Trash2 } from '~/components/ui/lucide';
import { followedCompany } from '@/lib/saved-search';
import type { SavedSearchRow } from '@/lib/supabase/database.types';
import { Text } from '~/components/ui/text';
import { useDeleteSavedSearch, useSetSearchAlerts } from '~/features/saved/queries';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * Saved searches and followed companies, with the weekly email's switch —
 * the website's SavedSearchList. A follow is the same row as a search, drawn
 * as what the reader did: a company mark and a way to the company, so "stop
 * following" is found where following was.
 *
 * Switching and deleting show at once and are put back if refused; a search
 * is one tap to make again, so the list never waits on the network.
 */
export function SavedSearchList({ searches }: { searches: SavedSearchRow[] }) {
  const t = useTranslations('savedSearch');
  const { colors } = useTheme();

  if (searches.length === 0) {
    return (
      <View
        style={{
          padding: space[6],
          ...corner('xl'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderStyle: 'dashed',
          borderColor: colors.border,
        }}
      >
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
          {t('empty')}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: space[2] }}>
      {searches.map((row) => (
        <SavedSearchItem key={row.id} row={row} />
      ))}
    </View>
  );
}

function SavedSearchItem({ row }: { row: SavedSearchRow }) {
  const t = useTranslations('savedSearch');
  const { colors, shadow } = useTheme();
  const alerts = useSetSearchAlerts();
  const remove = useDeleteSavedSearch();

  const company = followedCompany(row.query);
  // A row the list has not been read back with yet (a follow made a moment ago).
  const pending = row.id.startsWith('pending-');
  const open = () =>
    company
      ? router.push({ pathname: '/companies/[slug]', params: { slug: company } })
      : router.navigate(`/jobs?${row.query}` as Href);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        paddingStart: space[4],
        paddingEnd: space[1],
        paddingVertical: space[1],
        ...corner('xl'),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        boxShadow: shadow.card,
        backgroundColor: colors.card,
      }}
    >
      {company ? <Building2 size={16} color={colors.mutedForeground} /> : <Search size={16} color={colors.mutedForeground} />}

      <Pressable
        accessibilityRole="link"
        onPress={open}
        style={{ flex: 1, minHeight: hitTarget, justifyContent: 'center' }}
      >
        <Text weight="medium" numberOfLines={1}>
          {row.label}
        </Text>
      </Pressable>

      {/* A button that says its state, as on the website (aria-pressed). */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: row.alerts, disabled: pending }}
        disabled={pending}
        onPress={() => alerts.mutate({ id: row.id, alerts: !row.alerts })}
        hitSlop={6}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[1],
          minHeight: 32,
          paddingHorizontal: space[3],
          ...corner('full'),
          backgroundColor: row.alerts ? colors.secondary : colors.muted,
        }}
      >
        {row.alerts ? <Bell size={14} color={colors.primary} /> : <BellOff size={14} color={colors.mutedForeground} />}
        <Text variant="caption" weight="medium" tone={row.alerts ? 'primary' : 'mutedForeground'}>
          {row.alerts ? t('alertsOn') : t('alertsOff')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={company ? t('unfollow') : t('remove')}
        disabled={pending}
        onPress={() => remove.mutate({ id: row.id })}
        style={({ pressed }) => ({
          width: hitTarget,
          height: hitTarget,
          alignItems: 'center',
          justifyContent: 'center',
          ...corner('lg'),
          backgroundColor: pressed ? colors.muted : 'transparent',
        })}
      >
        <Trash2 size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}
