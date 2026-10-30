import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import { canAccessCandidateArea } from '@/lib/permissions';
import type { AgentVisibility } from '@/lib/supabase/database.types';
import { toast } from '~/components/feedback/toast';
import { Button } from '~/components/ui/button';
import { Download, EyeOff, Lock, Trash2 } from '~/components/ui/lucide';
import { Notice } from '~/components/ui/notice';
import { ChoiceRow, SettingsGroup, SettingsRow, SwitchRow } from '~/components/ui/settings-list';
import { LoadingState } from '~/components/ui/states';
import { shareMyData } from '~/features/account/settings';
import { useFewerKinds } from '~/features/jobs/fewer';
import { useListOwner } from '~/features/jobs/recent';
import { useHiddenAgentEntries } from '~/features/moderation/hidden-agents';
import { useHiddenCompanyEntries } from '~/features/moderation/hidden-companies';
import { useHiddenJobEntries } from '~/features/moderation/hidden-jobs';
import { useSaveCardFields } from '~/features/profile/card-fields';
import { setAnalyticsOptOut, useAnalyticsOptOut } from '~/lib/analytics';
import { ApiError } from '~/lib/api';
import { withAppMarker } from '~/lib/app-marker';
import { env } from '~/lib/env';
import { haptic } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

const VISIBILITIES: AgentVisibility[] = ['public', 'verified_employers_only', 'hidden'];

/**
 * Who sees what (the Privacy board), with what the platform keeps today: a
 * consultant's place in the directory — the profile form's own three
 * choices, saved the moment one is picked — and their data: a copy of it,
 * this phone's usage analytics, what they hid here, the policy, and deleting
 * the account.
 *
 * The board's finer controls (hiding the card from named companies, which
 * fields a company sees, a log of who revealed the number, contact hours)
 * have no column or action behind them yet: they are in the Phase B design
 * notes, not drawn here.
 */
export default function PrivacyScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const { session, actor } = useSession();
  const candidate = canAccessCandidateArea(actor);
  const card = useSaveCardFields();
  const optedOut = useAnalyticsOptOut();
  const [exporting, setExporting] = useState(false);
  const hiddenCount =
    useHiddenCompanyEntries().length + useHiddenAgentEntries().length + useHiddenJobEntries().length + useFewerKinds(useListOwner()).length;
  // The choice as just picked, drawn until the card is read back with it.
  const [picked, setPicked] = useState<AgentVisibility | null>(null);
  const visibility = picked ?? card.agent?.visibility ?? null;

  const choose = (next: AgentVisibility) => {
    if (next === visibility || card.isPending) return;
    haptic.selection();
    setPicked(next);
    card.saveFields(
      { visibility: next },
      {
        onSuccess: () => toast.show({ message: t('app.toast.changesSaved'), tone: 'success' }),
        onError: () => {
          setPicked(null);
          toast.show({ message: t('common.errorBody'), tone: 'destructive' });
        },
      },
    );
  };

  const exportData = () => {
    if (!session || exporting) return;
    setExporting(true);
    shareMyData(session.user.id, t('account.exportTitle'))
      .catch((failure: unknown) => {
        const status = failure instanceof ApiError ? failure.status : -1;
        toast.show({
          message: status === 429 ? t('app.account.exportLimit') : status === 0 ? t('app.offline.body') : t('common.errorBody'),
          tone: 'destructive',
        });
      })
      .then(() => setExporting(false));
  };

  const header = <Stack.Screen options={{ title: t('app.privacy.title') }} />;
  if (candidate && card.card.isPending) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: space[12],
          gap: space[6],
        }}
      >
        {candidate ? (
          card.agent ? (
            <SettingsGroup title={t('app.privacy.directory')} footer={t('app.privacy.directoryHint')}>
              <View accessibilityRole="radiogroup">
                {VISIBILITIES.map((value) => (
                  <ChoiceRow
                    key={value}
                    label={t(`visibility.${value}`)}
                    hint={t(
                      value === 'public'
                        ? 'visibility.publicHint'
                        : value === 'hidden'
                          ? 'visibility.hiddenHint'
                          : 'visibility.verifiedHint',
                    )}
                    selected={visibility === value}
                    disabled={!card.ready || card.isPending}
                    onPress={() => choose(value)}
                  />
                ))}
              </View>
            </SettingsGroup>
          ) : (
            <View style={{ gap: space[3] }}>
              <Notice tone="muted">{t('app.privacy.noCard')}</Notice>
              <Button label={t('app.privacy.noCardCta')} variant="outline" onPress={() => router.push('/account/profile')} />
            </View>
          )
        ) : null}

        <SettingsGroup title={t('app.privacy.data')}>
          {session ? (
            <SettingsRow
              icon={exporting ? <ActivityIndicator color={colors.primary} /> : <Download size={18} color={colors.primary} />}
              label={t('account.exportCta')}
              hint={t('app.privacy.exportHint')}
              busy={exporting}
              onPress={exportData}
            />
          ) : null}
          <SwitchRow
            testID="analytics"
            label={t('app.privacy.analytics')}
            hint={t('app.privacy.analyticsHint')}
            value={!optedOut}
            onChange={(on) => setAnalyticsOptOut(!on)}
          />
          {hiddenCount ? (
            <SettingsRow
              icon={<EyeOff size={18} color={colors.primary} />}
              label={t('app.privacy.hidden')}
              onPress={() => router.push('/account/hidden')}
            />
          ) : null}
          <SettingsRow
            icon={<Lock size={18} color={colors.primary} />}
            label={t('app.privacy.policy')}
            onPress={() => WebBrowser.openBrowserAsync(withAppMarker(`${env.siteUrl}/privacy`)).catch(() => {})}
          />
          {session ? (
            <SettingsRow
              icon={<Trash2 size={18} color={colors.destructive} />}
              label={t('app.account.deleteAccount')}
              destructive
              onPress={() => router.push('/account/delete')}
            />
          ) : null}
        </SettingsGroup>
      </ScrollView>
    </>
  );
}
