import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { EyeOff } from '~/components/ui/lucide';
import { EmptyState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { unhideAgent, useHiddenAgentEntries } from '~/features/moderation/hidden-agents';
import { unhideCompany, useHiddenCompanyEntries } from '~/features/moderation/hidden-companies';
import { unhideJob, useHiddenJobEntries } from '~/features/moderation/hidden-jobs';
import type { HiddenEntry } from '~/features/moderation/hidden-store';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * Everything hidden on this phone, and the way back: single listings set
 * aside (hidden-jobs.ts), the companies whose
 * listings the reader hid (hidden-companies.ts) and the consultants hidden
 * from the directory (hidden-agents.ts). Hiding takes them out of every list,
 * so their own pages — where "show again" also is — are no longer a tap
 * away; this list is. Kept on the phone, so it is here signed in or not.
 */
export default function HiddenScreen() {
  const t = useTranslations('app.moderation');
  const companies = useHiddenCompanyEntries();
  const agents = useHiddenAgentEntries();
  const jobs = useHiddenJobEntries();
  const header = <Stack.Screen options={{ title: t('hiddenList') }} />;

  if (!companies.length && !agents.length && !jobs.length) {
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
      </ScrollView>
    </>
  );
}

function Section({
  title,
  entries,
  unnamed,
  onShow,
}: {
  title: string;
  entries: readonly HiddenEntry[];
  unnamed: string;
  onShow: (entry: HiddenEntry) => void;
}) {
  const t = useTranslations('app.moderation');
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="label" weight="semibold" tone="mutedForeground" accessibilityRole="header" style={{ paddingHorizontal: space[1] }}>
        {title}
      </Text>
      <Card style={{ paddingVertical: space[1] }}>
        {entries.map((entry, index) => {
          const name = entry.name ?? unnamed;
          return (
            <View
              key={entry.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
                paddingVertical: space[2],
                borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
                borderTopColor: colors.border,
              }}
            >
              <Text style={{ flex: 1 }} numberOfLines={2}>
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
