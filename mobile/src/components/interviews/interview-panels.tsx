import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import type { InterviewInviteRow } from '@/lib/supabase/database.types';
import { toast } from '~/components/feedback/toast';
import { Button } from '~/components/ui/button';
import { CalendarClock, CalendarCheck, CalendarX2 } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useInterviewActions } from '~/features/interviews/interviews';
import { dialog } from '~/lib/dialog';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { CounterSheet, InviteSheet, interviewFailure } from './interview-sheets';

/** Where the interview is: the address, the link (opened), or nothing for a call. */
function Place({ invite }: { invite: InterviewInviteRow }) {
  const { colors } = useTheme();
  if (!invite.place) return null;
  if (invite.mode === 'video' && /^https?:\/\//i.test(invite.place)) {
    return (
      <Text
        variant="small"
        tone="primary"
        style={{ writingDirection: 'ltr', alignSelf: 'flex-start', color: colors.primary }}
        onPress={() => Linking.openURL(invite.place as string).catch(() => {})}
        accessibilityRole="link"
      >
        {invite.place}
      </Text>
    );
  }
  return (
    <Text variant="small" selectable>
      {invite.place}
    </Text>
  );
}

function Frame({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space[3], padding: space[3], ...corner('lg'), backgroundColor: colors.accent }}>
      {icon}
      <View style={{ flex: 1, gap: space[1.5] }}>{children}</View>
    </View>
  );
}

/**
 * The company's side, on the applicant's card: invite, or the standing
 * invitation — when and how, and where it stands — with the moves left:
 * accept the candidate's other time, change the time, cancel.
 */
export function CompanyInterview({
  applicationId,
  name,
  invite,
  closed,
  now,
}: {
  applicationId: string;
  name: string;
  invite: InterviewInviteRow | null;
  /** Withdrawn, turned down or hired: nobody is invited any more. */
  closed: boolean;
  now: number;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const sheet = useSheet();
  const { cancel, acceptProposed } = useInterviewActions();
  const live = invite && (invite.status === 'proposed' || invite.status === 'accepted' || invite.status === 'counter');

  const sheetView = sheet.mounted ? (
    <InviteSheet visible={sheet.open} onClose={() => sheet.hide()} onDismiss={sheet.onDismiss} applicationId={applicationId} name={name} now={now} />
  ) : null;

  if (!invite || invite.status === 'declined' || !live) {
    if (closed) return null;
    return (
      <View style={{ gap: space[2] }}>
        {invite?.status === 'declined' ? (
          <Text variant="small" tone="mutedForeground">
            {t('app.interview.status_declined')}
          </Text>
        ) : null}
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={t('app.interview.invite')}
            accessibilityLabel={`${t('app.interview.invite')}: ${name}`}
            variant="outline"
            size="sm"
            icon={<CalendarClock size={16} color={colors.foreground} />}
            onPress={sheet.show}
          />
        </View>
        {sheetView}
      </View>
    );
  }

  const when = formatDateTime(invite.starts_at, locale);
  const status =
    invite.status === 'counter' && invite.counter_starts_at
      ? t('app.interview.status_counter', { when: formatDateTime(invite.counter_starts_at, locale) })
      : t(`app.interview.status_${invite.status as 'proposed' | 'accepted'}`);

  return (
    <Frame icon={invite.status === 'accepted' ? <CalendarCheck size={18} color={colors.accentForeground} /> : <CalendarClock size={18} color={colors.accentForeground} />}>
      <Text variant="small" weight="semibold" testID="interview-line">
        {t('app.interview.line', { when, mode: t(`app.interview.mode_${invite.mode}`) })}
      </Text>
      <Place invite={invite} />
      <Text variant="caption" weight="medium" style={{ color: colors.accentForeground }}>
        {status}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {invite.status === 'counter' ? (
          <Button
            label={t('app.interview.acceptCounter')}
            size="sm"
            loading={acceptProposed.isPending}
            onPress={() =>
              acceptProposed.mutate(invite.id, {
                onSuccess: () => toast.show({ message: t('app.interview.agreed'), tone: 'success' }),
                onError: (failure) => toast.show({ message: t(interviewFailure(failure)), tone: 'destructive' }),
              })
            }
          />
        ) : null}
        <Button label={t('app.interview.reschedule')} variant="outline" size="sm" onPress={sheet.show} />
        <Button
          label={t('app.interview.cancel')}
          variant="ghost"
          size="sm"
          loading={cancel.isPending}
          onPress={() =>
            dialog.alert(t('app.interview.cancelConfirm'), undefined, [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('app.interview.cancel'),
                style: 'destructive',
                onPress: () =>
                  cancel.mutate(invite.id, {
                    onSuccess: () => toast.show({ message: t('app.interview.cancelled'), tone: 'success' }),
                    onError: (failure) => toast.show({ message: t(interviewFailure(failure)), tone: 'destructive' }),
                  }),
              },
            ])
          }
        />
      </View>
      {sheetView}
    </Frame>
  );
}

/**
 * The candidate's side, on their application: the invitation — when, how,
 * where, the company's note — and their answer: accept, propose another
 * time, or decline (asked first). Once answered, what they said.
 */
export function CandidateInterview({ invite, now }: { invite: InterviewInviteRow; now: number }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const sheet = useSheet();
  const { answer } = useInterviewActions();
  const [error, setError] = useState<string | null>(null);
  const when = formatDateTime(invite.starts_at, locale);
  const mode = t(`app.interview.mode_${invite.mode}`);

  const reply = (value: 'accepted' | 'declined') => {
    setError(null);
    answer.mutate(
      { id: invite.id, answer: value },
      {
        onSuccess: () => toast.show({ message: t('app.interview.answered'), tone: 'success' }),
        onError: (failure) => setError(t(interviewFailure(failure))),
      },
    );
  };

  if (invite.status === 'declined') {
    return (
      <Frame icon={<CalendarX2 size={18} color={colors.mutedForeground} />}>
        <Text variant="small" tone="mutedForeground">
          {t('app.interview.declinedLine')}
        </Text>
      </Frame>
    );
  }

  return (
    <Frame icon={invite.status === 'accepted' ? <CalendarCheck size={18} color={colors.accentForeground} /> : <CalendarClock size={18} color={colors.accentForeground} />}>
      <Text variant="small" weight="semibold" testID="interview-candidate">
        {invite.status === 'accepted' ? t('app.interview.yourTime', { when }) : t('app.interview.invitedTitle')}
      </Text>
      {invite.status === 'accepted' ? (
        <Text variant="small">{mode}</Text>
      ) : (
        <Text variant="small">{t('app.interview.line', { when, mode })}</Text>
      )}
      <Place invite={invite} />
      {invite.note ? <Text variant="small">{`«${invite.note}»`}</Text> : null}
      {invite.status === 'counter' && invite.counter_starts_at ? (
        <Text variant="caption" weight="medium" style={{ color: colors.accentForeground }}>
          {t('app.interview.countered', { when: formatDateTime(invite.counter_starts_at, locale) })}
        </Text>
      ) : null}
      {invite.status === 'proposed' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          <Button label={t('app.interview.accept')} size="sm" loading={answer.isPending && answer.variables?.answer === 'accepted'} onPress={() => reply('accepted')} />
          <Button label={t('app.interview.proposeOther')} variant="outline" size="sm" onPress={sheet.show} />
          <Button
            label={t('app.interview.decline')}
            variant="ghost"
            size="sm"
            onPress={() =>
              dialog.alert(t('app.interview.declineConfirm'), undefined, [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('app.interview.decline'), style: 'destructive', onPress: () => reply('declined') },
              ])
            }
          />
        </View>
      ) : null}
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {sheet.mounted ? <CounterSheet visible={sheet.open} onClose={() => sheet.hide()} onDismiss={sheet.onDismiss} interviewId={invite.id} now={now} /> : null}
    </Frame>
  );
}
