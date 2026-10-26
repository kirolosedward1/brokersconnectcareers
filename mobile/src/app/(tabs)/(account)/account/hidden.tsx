import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { EyeOff } from '~/components/ui/lucide';
import { EmptyState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { fewerKey, showAsUsual, useFewerKinds } from '~/features/jobs/fewer';
import { useListOwner } from '~/features/jobs/recent';
import { unhideAgent, useHiddenAgentEntries } from '~/features/moderation/hidden-agents';
import { unhideCompany, useHiddenCompanyEntries } from '~/features/moderation/hidden-companies';
import { unhideJob, useHiddenJobEntries } from '~/features/moderation/hidden-jobs';
import type { HiddenEntry } from '~/features/moderation/hidden-store';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * Everything hidden on this phone, and the way back: single listings set
 * aside (hidden-jobs.ts), the companies whose
 * listings the reader hid (hidden-companies.ts) and the consultants hidden
 * from the directory (hidden-agents.ts). Hiding takes them out of every list,
 * so their own pages — where "show again" also is — are no longer a tap
 * away; this list is. Kept on the phone, so it is here signed in or not.
 *
 * And the kinds of listing this person asked to see fewer of (fewer.ts),
 * which are not hidden — they come last among Home's suggestions — but are
 * set aside on this phone the same way, and taken back here the same way.
 */
export default function HiddenScreen() {
  const t = useTranslations('app.moderation');
  const companies = useHiddenCompanyEntries();
  const agents = useHiddenAgentEntries();
  const jobs = useHiddenJobEntries();
  const owner = useListOwner();
  const fewer = useFewerEntries(owner);
  const header = <Stack.Screen options={{ title: t('hiddenList') }} />;

  if (!companies.length && !agents.length && !jobs.length && !fewer.length) {
    return (
      <>
        {header}
        <EmptyState icon={EyeOff} title={t('hiddenNothing')} body={t('hiddenNothingBody')} />
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: gutter, gap: space[5] }}>
        <Text tone="mutedForeground">{t('hiddenListLede')}</Text>
        {jobs.length ? (
          <Section title={t('hiddenJobs')} entries={jobs} unnamed={t('unnamedJob')} onShow={(entry) => unhideJob(entry.id)} />
        ) : null}
        {companies.length ? (
          <Section
            title={t('hiddenCompanies')}
            entries={companies}
            unnamed={t('unnamedCompany')}
            onShow={(entry) => unhideCompany(entry.id)}
          />
        ) : null}
        {agents.length ? (
          <Section
            title={t('hiddenAgents')}
            entries={agents}
            unnamed={t('unnamedAgent')}
            onShow={(entry) => unhideAgent(entry.id)}
          />
        ) : null}
        {fewer.length ? (
          <Section
            title={t('fewerHeading')}
            note={t('fewerNote')}
            entries={fewer}
            unnamed={t('unnamedJob')}
            onShow={(entry) => showAsUsual(owner, entry.id)}
          />
        ) : null}
      </ScrollView>
    </>
  );
}

/** The kinds seen fewer of, each named as the menu found it: «بيع أوف بلان · التجمع الخامس». */
function useFewerEntries(owner: string): HiddenEntry[] {
  const t = useTranslations();
  const locale = useLocale();
  return useFewerKinds(owner).map((kind) => ({
    id: fewerKey(kind),
    name: `${t(`track.${kind.track}`)} · ${localized(locale, kind.district.name_ar, kind.district.name_en)}`,
    slug: null,
  }));
}

function Section({
  title,
  note,
  entries,
  unnamed,
  onShow,
}: {
  title: string;
  /** What being in this list does, when it is not "hidden". */
  note?: string;
  entries: readonly HiddenEntry[];
  unnamed: string;
  onShow: (entry: HiddenEntry) => void;
}) {
  const t = useTranslations('app.moderation');
  const { colors } = useTheme();
  const large = useLargeText();
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="label" weight="semibold" tone="mutedForeground" accessibilityRole="header" style={{ paddingHorizontal: space[1] }}>
        {title}
      </Text>
      {note ? (
        <Text variant="caption" tone="mutedForeground" style={{ paddingHorizontal: space[1] }}>
          {note}
        </Text>
      ) : null}
      <Card style={{ paddingVertical: space[1] }}>
        {entries.map((entry, index) => {
          const name = entry.name ?? unnamed;
          return (
            <View
              key={entry.id}
              style={{
                flexDirection: large ? 'column' : 'row',
                alignItems: large ? 'flex-start' : 'center',
                gap: large ? space[2] : space[3],
                paddingVertical: space[2],
                borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
                borderTopColor: colors.border,
              }}
            >
              <Text style={large ? { alignSelf: 'stretch' } : { flex: 1 }} numberOfLines={large ? undefined : 2}>
                {name}
              </Text>
              <Button
                label={t('showAgain')}
                accessibilityLabel={t('showAgainNamed', { name })}
                variant="outline"
                size="sm"
                onPress={() => onShow(entry)}
              />
            </View>
          );
        })}
      </Card>
    </View>
  );
}
