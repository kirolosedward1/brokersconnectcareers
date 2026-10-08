import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatNumber } from '@/lib/format';
import { parseAgentFilters, type AgentFilters } from '@/lib/agent-filters';
import { Button } from '~/components/ui/button';
import { BellPlus, BellRing, X } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { markSearchSeen, saveAgentSearch, savedAgentSearches, type SavedAgentSearch } from '~/features/directory/alerts';
import { agentFiltersToParams } from '~/features/directory/filters';
import { directorySearch } from '~/features/directory/queries';
import { useListOwner } from '~/features/jobs/recent';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * A narrowed directory kept as a search the phone asks again (alerts.ts):
 * "tell me about new ones" under the filters, and the kept searches above
 * the cards, each with how many consultants it has that were not there when
 * it was last looked at. Opening one shows it and counts them as seen.
 */
export function SaveAgentSearch({ filters, label }: { filters: AgentFilters; label: string }) {
  const t = useTranslations('app.agentAlerts');
  const { colors } = useTheme();
  const owner = useListOwner();
  const search = directorySearch(filters);
  const kept = savedAgentSearches.useItems(owner).some((saved) => saved.search === search);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (kept) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <BellRing size={16} color={colors.success} />
        <Text variant="small" weight="medium" tone="success">
          {t('kept')}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: space[1], alignItems: 'flex-start' }}>
      <Button
        label={t('keep')}
        variant="outline"
        size="sm"
        loading={busy}
        icon={<BellPlus size={16} color={colors.foreground} />}
        onPress={() => {
          setBusy(true);
          setFailed(false);
          saveAgentSearch(owner, search, label)
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      />
      {failed ? (
        <Text variant="caption" tone="destructive" accessibilityRole="alert">
          {t('failed')}
        </Text>
      ) : null}
    </View>
  );
}

export function SavedAgentSearches({ current }: { current: string }) {
  const t = useTranslations('app.agentAlerts');
  const locale = useLocale();
  const { colors } = useTheme();
  const owner = useListOwner();
  const searches = savedAgentSearches.useItems(owner);
  // Arrived at a kept search another way (its notification, a link): what it shows is seen now.
  const showing = searches.find((saved) => saved.search === current && saved.fresh > 0);
  useEffect(() => {
    if (showing) markSearchSeen(owner, showing).catch(() => {});
  }, [owner, showing]);
  if (!searches.length) return null;

  const open = (saved: SavedAgentSearch) => {
    router.setParams(agentFiltersToParams(parseAgentFilters(Object.fromEntries(new URLSearchParams(saved.search)))));
    markSearchSeen(owner, saved).catch(() => {});
  };

  return (
    <View style={{ gap: space[2] }}>
      <Text variant="small" weight="semibold" accessibilityRole="header">
        {t('title')}
      </Text>
      <View style={{ ...corner('xl'), borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' }}>
        {searches.map((saved, index) => (
          <View
            key={saved.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
              borderTopColor: colors.border,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saved.fresh ? `${saved.label}: ${t('fresh', { count: saved.fresh })}` : saved.label}
              onPress={() => open(saved)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: hitTarget + 4,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[2],
                paddingHorizontal: space[4],
                backgroundColor: pressed ? colors.muted : 'transparent',
              })}
            >
              <BellRing size={16} color={saved.fresh ? colors.primary : colors.mutedForeground} />
              <Text variant="small" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                {saved.label}
              </Text>
              {saved.fresh ? (
                <View style={{ minWidth: 22, paddingHorizontal: 6, height: 22, ...corner('full'), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
                  <Text variant="caption" weight="bold" style={{ color: colors.primaryForeground }}>
                    {formatNumber(saved.fresh, locale)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('stop')}: ${saved.label}`}
              onPress={() => savedAgentSearches.remove(owner, saved.id)}
              style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
