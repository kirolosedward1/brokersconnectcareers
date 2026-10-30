import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { OPERATOR } from '@/lib/business';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Mail, TriangleAlert } from '~/components/ui/lucide';
import { Num } from '~/components/ui/num';
import { SettingsGroup, SettingsRow } from '~/components/ui/settings-list';
import { Text } from '~/components/ui/text';
import { useMobileConfig } from '~/features/config';
import { useServiceStatus } from '~/features/support/status';
import { buildMarker, shownVersion } from '~/features/update';
import { dialog } from '~/lib/dialog';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';

const QUESTIONS = ['1', '2', '3', '4', '5', '6'] as const;

/**
 * Help (the Support board): the questions the website's app page answers, in
 * its own words; writing to the support inbox, or reporting a problem with
 * the version and the phone filled in; whether the service is up, as the
 * website's health check says; and the version this phone runs.
 *
 * Support conversations inside the app and a support WhatsApp line have no
 * inbox or number behind them yet (Phase B design notes); writing to us is
 * email, as on the website.
 */
export default function SupportScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const config = useMobileConfig();
  const status = useServiceStatus();
  const supportEmail = config.data?.supportEmail || OPERATOR.email;
  const version = shownVersion() ?? '';
  const marker = buildMarker();

  const write = (subject?: string, body?: string) => {
    const query = [subject ? `subject=${encodeURIComponent(subject)}` : null, body ? `body=${encodeURIComponent(body)}` : null]
      .filter(Boolean)
      .join('&');
    // A phone with no mail app to write it opens nothing: it is told the address instead.
    Linking.openURL(`mailto:${supportEmail}${query ? `?${query}` : ''}`).catch(() => dialog.alert(t('app.account.contact'), supportEmail));
  };

  const device = [Platform.OS === 'ios' ? 'iOS' : Platform.OS, Platform.Version].filter(Boolean).join(' ');
  const statusLine =
    status.data === 'ok'
      ? {
          icon: <CheckCircle2 size={18} color={colors.success} />,
          words: t('app.support.statusOk'),
        }
      : status.data === 'degraded'
        ? {
            icon: <AlertTriangle size={18} color={colors.warning} />,
            words: t('app.support.statusDegraded'),
          }
        : status.data === 'down'
          ? {
              icon: <TriangleAlert size={18} color={colors.destructive} />,
              words: t('app.support.statusDown'),
            }
          : status.isPending
            ? {
                icon: <Info size={18} color={colors.mutedForeground} />,
                words: t('app.support.checking'),
              }
            : {
                icon: <Info size={18} color={colors.mutedForeground} />,
                words: t('app.support.statusUnknown'),
              };

  return (
    <>
      <Stack.Screen options={{ title: t('app.support.title') }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: space[12],
          gap: space[6],
        }}
      >
        <SettingsGroup title={t('appPage.faq.title')}>
          {QUESTIONS.map((n) => (
            <Question key={n} question={t(`appPage.faq.q${n}`)} answer={t(`appPage.faq.a${n}`)} />
          ))}
        </SettingsGroup>

        <SettingsGroup title={t('app.support.contact')}>
          <SettingsRow icon={<Mail size={18} color={colors.primary} />} label={t('app.support.email')} onPress={() => write()} />
          <SettingsRow
            icon={<AlertTriangle size={18} color={colors.primary} />}
            label={t('app.support.report')}
            hint={t('app.support.reportHint')}
            onPress={() =>
              write(
                t('app.support.reportSubject'),
                t('app.support.reportBody', {
                  version: [version, marker].filter(Boolean).join(' · '),
                  device,
                }),
              )
            }
          />
        </SettingsGroup>

        <SettingsGroup title={t('app.support.status')}>
          <View
            accessible
            accessibilityLiveRegion="polite"
            testID="service-status"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              minHeight: hitTarget + 10,
              paddingHorizontal: space[4],
            }}
          >
            {statusLine.icon}
            <Text style={{ flex: 1 }}>{statusLine.words}</Text>
          </View>
        </SettingsGroup>

        {version ? (
          <View
            accessible
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              gap: space[1],
            }}
          >
            <Text variant="caption" tone="mutedForeground">
              {t('app.support.version')}
            </Text>
            <Num variant="caption" tone="mutedForeground" value={version} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

/** One question, its answer opened under it. A button to VoiceOver that says whether it is open. */
function Question({ question, answer }: { question: string; answer: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={{
        borderTopWidth: StyleSheet.hairlineWidth * 2,
        borderTopColor: colors.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => ({
          minHeight: hitTarget + 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          paddingHorizontal: space[4],
          paddingVertical: space[2],
          backgroundColor: pressed ? colors.muted : 'transparent',
        })}
      >
        <Text weight="semibold" style={{ flex: 1 }}>
          {question}
        </Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <ChevronDown size={18} color={colors.mutedForeground} />
        </View>
      </Pressable>
      {open ? (
        <Text variant="small" tone="mutedForeground" style={{ paddingHorizontal: space[4], paddingBottom: space[4] }}>
          {answer}
        </Text>
      ) : null}
    </View>
  );
}
