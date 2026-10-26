import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { TaxonomyKind } from '@/lib/supabase/database.types';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, SectionTitle } from '~/components/admin/kit';
import { openTaxonomyForm, TaxonomyFormHost } from '~/components/admin/taxonomy-form';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { Layers, Pencil, Plus, Trash2 } from '~/components/ui/lucide';
import { Notice } from '~/components/ui/notice';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  FIXED_LISTS,
  TAXONOMY_TABS,
  taxonomyTabOf,
  useTaxonomyList,
  type Governorate,
  type TaxonomyEntry,
  type TaxonomyTab,
} from '~/features/admin/taxonomy';
import { useTabList } from '~/features/tab-bar';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * The lists the product is built from — the website's /admin/taxonomy:
 * districts, governorates and developers, each row with how much uses it,
 * added and renamed through the form (the slug typed once and never again)
 * and deleted only when nothing uses it; and the fixed lists — tracks,
 * experience bands, employment types, company types — shown as what they
 * are: a change to one is a release, not a button here.
 */
export default function AdminTaxonomyScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.taxonomy') }} />
      <AdminGate>
        <Lists />
        {/* The add and rename form, drawn once here, outside the list's rows. */}
        <TaxonomyFormHost />
      </AdminGate>
    </>
  );
}

function Lists() {
  const t = useTranslations();
  // The tab a link names (`?kind=` on /admin/taxonomy); the districts otherwise.
  const params = useLocalSearchParams<{ kind?: string }>();
  const [tab, setTab] = useState<TaxonomyTab>(() => taxonomyTabOf(params.kind));

  const tabs = (
    // One list at a time: a radio group, as VoiceOver should say it.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('admin.taxonomy')}
      contentContainerStyle={{ gap: space[2] }}
    >
      {TAXONOMY_TABS.map((option) => (
        <Chip key={option} radio label={t(`admin.taxonomyTab.${option}`)} selected={option === tab} onPress={() => setTab(option)} />
      ))}
    </ScrollView>
  );

  if (tab === 'fixed') return <FixedLists tabs={tabs} />;
  return <Entries key={tab} kind={tab} tabs={tabs} />;
}

/** The lede and the tabs, over whichever list is open. */
function Header({ tabs, children }: { tabs: ReactNode; children?: ReactNode }) {
  const t = useTranslations();
  return (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('admin.taxonomyLede')}
      </Text>
      {tabs}
      {children}
    </View>
  );
}

function Entries({ kind, tabs }: { kind: TaxonomyKind; tabs: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const read = useTaxonomyList(kind);
  const pull = usePullRefresh(() => read.refetch());
  const list = useTabList<FlashListRef<TaxonomyEntry>>();
  const governorates = read.data?.governorates ?? [];

  let body: ReactNode = null;
  if (read.isPending) body = <LoadingState />;
  // A list that could not be read is said so: never "nothing in this list".
  else if (read.isError && !read.data) body = <ErrorState error={read.error} onRetry={() => read.refetch()} />;

  const header = (
    <Header tabs={tabs}>
      {read.data ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
          <SectionTitle>{t('admin.entriesCount', { count: formatNumber(read.data.rows.length, locale) })}</SectionTitle>
          <Button
            label={t('admin.addEntry')}
            size="sm"
            icon={<Plus size={16} color={colors.primaryForeground} />}
            onPress={() => openTaxonomyForm({ kind, entry: null, governorates })}
          />
        </View>
      ) : null}
    </Header>
  );

  return (
    <FlashList
      {...list}
      data={body ? [] : (read.data?.rows ?? [])}
      keyExtractor={(row) => String(row.id)}
      renderItem={({ item }) => <EntryRow key={item.id} kind={kind} entry={item} governorates={governorates} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={header}
      ListEmptyComponent={body ?? <EmptyState icon={Layers} title={t('app.admin.taxonomy.empty')} />}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

/** One row: its names and slug, its governorate for a district, and its levers — rename, and delete only while nothing uses it. */
function EntryRow({ kind, entry, governorates }: { kind: TaxonomyKind; entry: TaxonomyEntry; governorates: Governorate[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const governorate = kind === 'district' ? governorates.find((g) => g.id === entry.governorate_id) : undefined;

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text weight="semibold">{entry.name_ar}</Text>
        <Text variant="small" tone="mutedForeground" style={{ writingDirection: 'ltr' }}>
          {entry.name_en}
        </Text>
        <Text variant="caption" tone="mutedForeground" selectable style={{ writingDirection: 'ltr' }}>
          {entry.slug}
        </Text>
        {governorate ? (
          <Text variant="caption" tone="mutedForeground">
            {`${t('admin.governorate')}: ${localized(locale, governorate.name_ar, governorate.name_en)}`}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        <Button
          label={t('app.admin.taxonomy.edit')}
          accessibilityLabel={`${t('app.admin.taxonomy.edit')}: ${entry.name_ar}`}
          variant="outline"
          size="sm"
          icon={<Pencil size={16} color={colors.foreground} />}
          onPress={() => openTaxonomyForm({ kind, entry, governorates })}
        />
        {entry.uses > 0 ? (
          // In use: the database would refuse the delete, so it is not offered — rename it instead.
          <Badge variant="outline" label={t('admin.inUse', { count: entry.uses })} />
        ) : (
          <Button
            label={t('admin.deleteEntry')}
            accessibilityLabel={`${t('admin.deleteEntry')}: ${entry.name_ar}`}
            variant="ghost"
            size="sm"
            icon={<Trash2 size={16} color={colors.destructive} />}
            onPress={() =>
              openDecision({
                lever: { do: 'deleteTaxonomy', kind, id: entry.id },
                title: t('admin.deleteEntryTitle', { name: entry.name_ar }),
                body: t('admin.deleteEntryBody'),
                confirmLabel: t('admin.deleteEntry'),
                destructive: true,
                reason: 'none',
              })
            }
          />
        )}
      </View>
    </Card>
  );
}

/** The lists fixed in the code and the database, read-only, each value with its word. */
function FixedLists({ tabs }: { tabs: ReactNode }) {
  const t = useTranslations();
  const list = useTabList();
  return (
    <ScrollView {...list} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}>
      <Header tabs={tabs} />
      <Notice tone="muted">{t('admin.fixedListsHint')}</Notice>
      {FIXED_LISTS.map((fixed) => (
        <Card key={fixed.title} style={{ gap: space[2] }}>
          <SectionTitle>{t(`admin.${fixed.title}`)}</SectionTitle>
          {fixed.values.map((value) => (
            <View key={value} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
              <Text variant="small" style={{ flexShrink: 1 }}>
                {t(`${fixed.namespace}.${value}` as never)}
              </Text>
              <Text variant="caption" tone="mutedForeground" style={{ writingDirection: 'ltr' }}>
                {value}
              </Text>
            </View>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}
