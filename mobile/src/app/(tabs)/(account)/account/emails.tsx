import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useSaveEmailPreferences, type EmailPreferences } from '~/features/account/settings';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * What we email — the website's switches on /dashboard/account: each kind of
 * email on or off, saved as it is flipped and put back if the website
 * refuses, rather than showing a setting that did not take. An employer's
 * list differs from a candidate's, as on the website.
 */
export default function EmailsScreen() {
  const t = useTranslations();
  const { session, viewer } = useSession();
  const header = <Stack.Screen options={{ title: t('account.emailsTitle') }} />;

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
  if (!viewer?.profile) {
    return (
      <>
        {header}
        <ViewerPending />
      </>
    );
  }

  const profile = viewer.profile;
  return (
    <>
      {header}
      <Switches
        employer={profile.role === 'employer'}
        initial={{
          notify_applications: profile.notify_applications,
          notify_status: profile.notify_status,
          notify_digest: profile.notify_digest,
          notify_applicant_digest: profile.notify_applicant_digest,
          notify_profile_nudge: profile.notify_profile_nudge,
        }}
      />
    </>
  );
}

function Switches({ employer, initial }: { employer: boolean; initial: EmailPreferences }) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const { colors, shadow } = useTheme();
  const save = useSaveEmailPreferences();
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const rows: { key: keyof EmailPreferences; label: string; hint: string }[] = [
    ...(employer
      ? [
          { key: 'notify_applications' as const, label: t('notifyApplications'), hint: t('notifyApplicationsHint') },
          // How often, not whether — and nothing with the one above off.
          { key: 'notify_applicant_digest' as const, label: t('notifyApplicantDigest'), hint: t('notifyApplicantDigestHint') },
        ]
      : []),
    { key: 'notify_status', label: t('notifyStatus'), hint: t('notifyStatusHint') },
    ...(employer ? [] : [{ key: 'notify_digest' as const, label: t('notifyDigest'), hint: t('notifyDigestHint') }]),
    // The profile reminder, off unless turned on — offered only where the
    // database has the switch (migration 337), as on the website.
    ...(!employer && typeof initial.notify_profile_nudge === 'boolean'
      ? [{ key: 'notify_profile_nudge' as const, label: t('notifyProfileNudge'), hint: t('notifyProfileNudgeHint') }]
      : []),
  ];

  const flip = (key: keyof EmailPreferences) => {
    const before = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaved(false);
    setFailed(false);
    save.mutate(next, {
      onSuccess: () => setSaved(true),
      onError: () => {
        setPrefs(before);
        setFailed(true);
      },
    });
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}
    >
      <Text tone="mutedForeground">{t('emailsBody')}</Text>
      {rows.map((row) => (
        <View
          key={row.key}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            padding: space[4],
            ...corner('xl'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.border,
            boxShadow: shadow.card,
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
            value={Boolean(prefs[row.key])}
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
    </ScrollView>
  );
}
