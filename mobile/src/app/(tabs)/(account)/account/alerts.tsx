import { useState } from 'react';
import { Linking, ScrollView, Switch, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { usePushControls } from '~/features/push/controls';
import { pushAvailable, usePushState } from '~/features/push/device';
import { pushPreferencesOf, useSavePushPreferences, type PushPreferences } from '~/features/push/preferences';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

/**
 * Pushes on this phone: on or off for the person signed in, without going to
 * the phone's settings — and when the phone's settings have them off, that
 * said plainly, with the way there. With them on, which kinds to hear about
 * and whether to keep the night quiet: the person's choices, for all their
 * phones (migration 335). The emails are their own switches
 * (/account/emails); a push is a second delivery of the bell, not a third
 * kind of message.
 */
export default function AlertsScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const { session, viewer } = useSession();
  const state = usePushState();
  const { turnOn, turnOff } = usePushControls();
  const header = <Stack.Screen options={{ title: t('app.push.title') }} />;

  if (!session) {
    return (
      <>
        {header}
        <EmptyState
          title={t('app.account.signedOutTitle')}
          action={<Button label={t('nav.signIn')} onPress={() => router.push('/sign-in')} />}
        />
      </>
    );
  }
  // No push project in this build (Expo Go, or before the EAS project exists):
  // a switch here would turn on nothing.
  if (!pushAvailable()) {
    return (
      <>
        {header}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space[4], gap: space[4] }}>
          <Notice tone="muted">
            <Text variant="small">{t('app.push.unavailable')}</Text>
          </Notice>
        </ScrollView>
      </>
    );
  }
  if (!viewer?.profile || !state.data) {
    return (
      <>
        {header}
        <ViewerPending />
      </>
    );
  }

  const denied = state.data.permission === 'denied';
  const on = state.data.permission === 'granted' && !state.data.off;
  const pending = turnOn.isPending || turnOff.isPending;
  const employer = viewer.profile.role === 'employer';
  const hint = employer ? t('app.push.hintEmployer') : t('app.push.hintCandidate');
  const preferences = pushPreferencesOf(viewer.profile);

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[4] }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            padding: space[4],
            borderRadius: radius.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium">{t('app.push.switch')}</Text>
            <Text variant="small" tone="mutedForeground">
              {hint}
            </Text>
          </View>
          <Switch
            value={on}
            onValueChange={(next) => (next ? turnOn.mutate() : turnOff.mutate())}
            disabled={denied || pending}
            accessibilityLabel={t('app.push.switch')}
            accessibilityHint={hint}
            trackColor={{ true: colors.primary, false: colors.input }}
          />
        </View>

        {/* The phone said no: only its settings can say yes now. */}
        {denied ? (
          <Notice tone="muted">
            <Text variant="small">{t('app.push.denied')}</Text>
            <View style={{ alignItems: 'flex-start', marginTop: space[2] }}>
              <Button
                label={t('app.push.openSettings')}
                variant="outline"
                size="sm"
                onPress={() => Linking.openSettings().catch(() => {})}
              />
            </View>
          </Notice>
        ) : null}

        {on && preferences ? <Kinds employer={employer} initial={preferences} /> : null}

        {turnOn.isError ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {t('app.push.failed')}
          </Text>
        ) : null}
        {turnOff.isError ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {t('common.errorBody')}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

const KINDS = ['push_job_alerts', 'push_applications', 'push_account', 'push_quiet_hours'] as const;

/**
 * Which kinds reach the phones, and quiet hours: saved as each is flipped —
 * that switch alone — and put back if the website refuses, as the email
 * switches are. New listings are a candidate's only — an employer has no
 * saved searches.
 */
function Kinds({ employer, initial }: { employer: boolean; initial: PushPreferences }) {
  const t = useTranslations('app.push');
  const tCommon = useTranslations('common');
  const { colors } = useTheme();
  const save = useSavePushPreferences();
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  // A switch flipped here shows what was flipped. The others follow the
  // saved values as they arrive — a change made on another phone, or a read
  // still on its way when this opened — where they used to keep the first
  // copy for as long as the screen was open.
  const [touched, setTouched] = useState<ReadonlySet<keyof PushPreferences>>(() => new Set());
  const [seen, setSeen] = useState(initial);
  if (KINDS.some((kind) => seen[kind] !== initial[kind])) {
    setSeen(initial);
    setPrefs((current) => {
      const next = { ...current };
      for (const kind of KINDS) if (!touched.has(kind)) next[kind] = initial[kind];
      return next;
    });
  }

  const rows: { key: keyof PushPreferences; label: string; hint: string }[] = [
    ...(employer ? [] : [{ key: 'push_job_alerts' as const, label: t('jobAlerts'), hint: t('jobAlertsHint') }]),
    employer
      ? { key: 'push_applications', label: t('applicationsEmployer'), hint: t('applicationsEmployerHint') }
      : { key: 'push_applications', label: t('applicationsCandidate'), hint: t('applicationsCandidateHint') },
    employer
      ? { key: 'push_account', label: t('accountEmployer'), hint: t('accountEmployerHint') }
      : { key: 'push_account', label: t('accountCandidate'), hint: t('accountCandidateHint') },
    { key: 'push_quiet_hours', label: t('quiet'), hint: t('quietHint') },
  ];

  const flip = (key: keyof PushPreferences) => {
    const value = !prefs[key];
    setPrefs((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set(current).add(key));
    setSaved(false);
    setFailed(false);
    save.mutate(
      { [key]: value },
      {
        onSuccess: () => setSaved(true),
        onError: () => {
          setPrefs((current) => ({ ...current, [key]: !value }));
          setTouched((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
          setFailed(true);
        },
      },
    );
  };

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ gap: 2, marginTop: space[2] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('kindsTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('kindsBody')}
        </Text>
      </View>
      {rows.map((row) => (
        <View
          key={row.key}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            padding: space[4],
            borderRadius: radius.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium">{row.label}</Text>
            <Text variant="small" tone="mutedForeground">
              {row.hint}
            </Text>
          </View>
          <Switch
            value={prefs[row.key]}
            onValueChange={() => flip(row.key)}
            disabled={save.isPending}
            accessibilityLabel={row.label}
            accessibilityHint={row.hint}
            trackColor={{ true: colors.primary, false: colors.input }}
          />
        </View>
      ))}
      {saved ? (
        <Text variant="small" tone="success" accessibilityLiveRegion="polite">
          {tCommon('saveSuccess')}
        </Text>
      ) : null}
      {failed ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {tCommon('errorBody')}
        </Text>
      ) : null}
    </View>
  );
}
