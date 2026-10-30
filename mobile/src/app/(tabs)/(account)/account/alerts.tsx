import { useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
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
import { useSaveEmailPreferences, type EmailPreferences } from '~/features/account/settings';
import { useStoredFields } from '~/lib/use-stored-fields';
import { useSession } from '~/lib/session';
import { useScreenRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { UserRound } from '~/components/ui/lucide';
import { toast } from '~/components/feedback/toast';
import { markupTags } from '~/i18n/rich';

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
  const { colors, shadow } = useTheme();
  const { session, viewer } = useSession();
  const state = usePushState();
  const pull = useScreenRefresh();
  const { turnOn, turnOff } = usePushControls();
  const header = <Stack.Screen options={{ title: t('app.push.title') }} />;

  if (!session) {
    return (
      <>
        {header}
        <EmptyState
          icon={UserRound}
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
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: gutter, gap: space[4] }}>
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
        refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}
      >
        <View
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

        <Kinds
          employer={employer}
          initial={preferences}
          pushOn={on}
          email={{
            notify_applications: viewer.profile.notify_applications,
            notify_status: viewer.profile.notify_status,
            notify_digest: viewer.profile.notify_digest,
            notify_applicant_digest: viewer.profile.notify_applicant_digest,
            notify_profile_nudge: viewer.profile.notify_profile_nudge,
          }}
        />

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

/** A kind of message, and where it is said: on the phone (a push), by email — or always, and not a choice. */
type MatrixRow = {
  key: string;
  label: string;
  hint: string;
  phone: keyof PushPreferences | null;
  email: keyof EmailPreferences | 'always' | null;
  /** What VoiceOver calls the email switch: the email's own name (/account/emails). */
  emailLabel?: string;
};

/**
 * Each kind of message and each way it can come (v1.1): a row a kind, a
 * column for the phone and one for email — the same switches as the push
 * preferences (migration 335) and the website's email switches, saved as
 * each is flipped and put back if the website refuses. The account and its
 * security are always emailed. The phone's column only while pushes are on
 * for this phone; the quiet night under them, the phone's alone; and one
 * card that sets the recommended way.
 */
function Kinds({
  employer,
  initial,
  pushOn,
  email: storedEmail,
}: {
  employer: boolean;
  initial: PushPreferences | null;
  pushOn: boolean;
  email: EmailPreferences;
}) {
  const t = useTranslations('app.push');
  const tAccount = useTranslations('account');
  const tCommon = useTranslations('common');
  const tApp = useTranslations('app.toast');
  const { colors, shadow } = useTheme();
  const save = useSavePushPreferences();
  const saveEmail = useSaveEmailPreferences();
  const emails = useStoredFields(storedEmail);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const phoneShown = pushOn && Boolean(initial);
  const base = initial ?? ({} as PushPreferences);

  // A switch shows the saved value as last read — a change made on another
  // phone, a read still on its way when this opened — except one flipped
  // here: that shows the flip while it is saved, and once saved until the
  // profile is read again. Refused, it shows the last read, which may have
  // changed while the save was on its way.
  const [flipped, setFlipped] = useState<Partial<Record<keyof PushPreferences, { value: boolean; saving: boolean }>>>(
    {},
  );
  const [seen, setSeen] = useState(base);
  if (KINDS.some((kind) => seen[kind] !== base[kind])) {
    // A read newer than the saves that are done: they give way to it.
    setSeen(base);
    setFlipped((current) => {
      const next = { ...current };
      for (const kind of KINDS) if (next[kind] && !next[kind].saving) delete next[kind];
      return next;
    });
  }
  const shown = (key: keyof PushPreferences) => flipped[key]?.value ?? base[key];
  const settle = (key: keyof PushPreferences, done: boolean) =>
    setFlipped((current) => {
      const next = { ...current };
      const entry = next[key];
      if (done && entry) next[key] = { ...entry, saving: false };
      else delete next[key];
      return next;
    });

  const said = () => {
    setSaved(true);
    toast.show({ message: tApp('changesSaved'), tone: 'success' });
  };

  const flip = (key: keyof PushPreferences) => {
    const value = !shown(key);
    setFlipped((current) => ({ ...current, [key]: { value, saving: true } }));
    setSaved(false);
    setFailed(false);
    save.mutate(
      { [key]: value },
      {
        onSuccess: () => {
          settle(key, true);
          said();
        },
        onError: () => {
          settle(key, false);
          setFailed(true);
        },
      },
    );
  };

  const flipEmail = (key: keyof EmailPreferences) => {
    const next = { ...emails.fields, [key]: !emails.fields[key] };
    emails.set({ [key]: next[key] });
    setSaved(false);
    setFailed(false);
    saveEmail.mutate(next, {
      onSuccess: () => {
        emails.saved(next);
        said();
      },
      onError: () => {
        emails.set({ [key]: emails.fields[key] });
        setFailed(true);
      },
    });
  };

  // The way the product suggests: every kind on, both ways, and the night quiet.
  const recommended = () => {
    setSaved(false);
    setFailed(false);
    const push: Partial<PushPreferences> = phoneShown
      ? { push_applications: true, push_account: true, push_quiet_hours: true, ...(employer ? {} : { push_job_alerts: true }) }
      : {};
    const mail: EmailPreferences = {
      ...emails.fields,
      notify_status: true,
      ...(employer ? { notify_applications: true, notify_applicant_digest: true } : { notify_digest: true }),
    };
    emails.set(mail);
    const both = [
      Object.keys(push).length ? new Promise<void>((resolve, reject) => save.mutate(push, { onSuccess: () => resolve(), onError: reject })) : Promise.resolve(),
      new Promise<void>((resolve, reject) => saveEmail.mutate(mail, { onSuccess: () => resolve(), onError: reject })),
    ];
    Promise.all(both)
      .then(() => {
        emails.saved(mail);
        said();
      })
      .catch(() => {
        emails.set(storedEmail);
        setFailed(true);
      });
  };

  const rows: MatrixRow[] = employer
    ? [
        { key: 'applications', label: t('applicationsEmployer'), hint: t('applicationsEmployerHint'), phone: 'push_applications', email: 'notify_applications', emailLabel: tAccount('notifyApplications') },
        { key: 'digest', label: tAccount('notifyApplicantDigest'), hint: tAccount('notifyApplicantDigestHint'), phone: null, email: 'notify_applicant_digest', emailLabel: tAccount('notifyApplicantDigest') },
        { key: 'status', label: tAccount('notifyStatus'), hint: tAccount('notifyStatusHint'), phone: null, email: 'notify_status', emailLabel: tAccount('notifyStatus') },
        { key: 'account', label: t('accountEmployer'), hint: t('accountEmployerHint'), phone: 'push_account', email: 'always' },
      ]
    : [
        { key: 'jobs', label: t('jobAlerts'), hint: t('jobAlertsHint'), phone: 'push_job_alerts', email: 'notify_digest', emailLabel: tAccount('notifyDigest') },
        { key: 'applications', label: t('applicationsCandidate'), hint: t('applicationsCandidateHint'), phone: 'push_applications', email: 'notify_status', emailLabel: tAccount('notifyStatus') },
        ...(typeof storedEmail.notify_profile_nudge === 'boolean'
          ? [{ key: 'nudge', label: tAccount('notifyProfileNudge'), hint: tAccount('notifyProfileNudgeHint'), phone: null, email: 'notify_profile_nudge' as const, emailLabel: tAccount('notifyProfileNudge') }]
          : []),
        { key: 'account', label: t('accountCandidate'), hint: t('accountCandidateHint'), phone: 'push_account', email: 'always' },
      ];

  const card = {
    ...corner('xl'),
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    boxShadow: shadow.card,
    backgroundColor: colors.card,
  } as const;

  return (
    <View style={{ gap: space[3] }}>
      {/* The recommended way, in one tap. */}
      <View style={[card, { padding: space[4], gap: space[2], borderColor: colors.champagne }]}>
        <Text weight="semibold">{t('recommendedTitle')}</Text>
        <Text variant="small" tone="mutedForeground">
          {t('recommendedBody')}
        </Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button label={t('recommendedApply')} size="sm" variant="outline" disabled={save.isPending || saveEmail.isPending} onPress={recommended} />
        </View>
      </View>

      <View style={{ gap: 2, marginTop: space[2] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('matrixTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('kindsBody')}
        </Text>
      </View>
      <View style={card}>
        <View style={{ flexDirection: 'row', paddingHorizontal: space[4], paddingTop: space[3], gap: space[3] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ flex: 1 }} />
          <Text variant="caption" weight="semibold" tone="mutedForeground" style={{ width: 56, textAlign: 'center' }}>
            {t('channelPhone')}
          </Text>
          <Text variant="caption" weight="semibold" tone="mutedForeground" style={{ width: 56, textAlign: 'center' }}>
            {t('channelEmail')}
          </Text>
        </View>
        {rows.map((row, index) => (
          <View
            key={row.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              padding: space[4],
              borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
              borderTopColor: colors.border,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="medium">{row.label}</Text>
              <Text variant="caption" tone="mutedForeground">
                {row.hint}
              </Text>
            </View>
            <View style={{ width: 56, alignItems: 'center' }}>
              {row.phone && phoneShown ? (
                <Switch
                  value={shown(row.phone)}
                  onValueChange={() => flip(row.phone as keyof PushPreferences)}
                  disabled={save.isPending}
                  accessibilityLabel={row.label}
                  accessibilityHint={row.hint}
                  trackColor={{ true: colors.primary, false: colors.input }}
                />
              ) : (
                <Text variant="caption" tone="mutedForeground" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  —
                </Text>
              )}
            </View>
            <View style={{ width: 56, alignItems: 'center' }}>
              {row.email === 'always' ? (
                <Text variant="caption" weight="semibold" tone="success" accessibilityLabel={t('alwaysEmailed')}>
                  {t('always')}
                </Text>
              ) : row.email ? (
                <Switch
                  value={Boolean(emails.fields[row.email])}
                  onValueChange={() => flipEmail(row.email as keyof EmailPreferences)}
                  disabled={saveEmail.isPending}
                  accessibilityLabel={row.emailLabel ?? row.label}
                  accessibilityHint={t('channelEmail')}
                  trackColor={{ true: colors.primary, false: colors.input }}
                />
              ) : (
                <Text variant="caption" tone="mutedForeground" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  —
                </Text>
              )}
            </View>
          </View>
        ))}
      </View>

      {/* The night kept quiet: the phone's alone. */}
      {phoneShown ? (
        <View style={[card, { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium">{t('quiet')}</Text>
            <Text variant="small" tone="mutedForeground">
              {t.markup('quietHint', markupTags)}
            </Text>
          </View>
          <Switch
            value={shown('push_quiet_hours')}
            onValueChange={() => flip('push_quiet_hours')}
            disabled={save.isPending}
            accessibilityLabel={t('quiet')}
            accessibilityHint={t.markup('quietHint', markupTags)}
            trackColor={{ true: colors.primary, false: colors.input }}
          />
        </View>
      ) : null}

      {/* What iOS keeps for each phone: its sound, its badge, what the lock screen shows. */}
      <View style={[card, { padding: space[4], gap: space[2] }]}>
        <Text weight="semibold">{t('moreTitle')}</Text>
        <Text variant="small" tone="mutedForeground">
          {t('moreBody')}
        </Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button label={t('moreSettings')} size="sm" variant="ghost" onPress={() => Linking.openSettings().catch(() => {})} />
        </View>
      </View>

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
