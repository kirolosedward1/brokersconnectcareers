import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { InterviewMode } from '@/lib/supabase/database.types';
import { toast } from '~/components/feedback/toast';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { FormSheet } from '~/components/ui/form-sheet';
import { Segmented } from '~/components/ui/segmented';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { cairoInstant, nextCairoDays } from '~/features/interviews/cairo-time';
import { InterviewRefused, useInterviewActions } from '~/features/interviews/interviews';
import { markupTags } from '~/i18n/rich';
import { ApiError } from '~/lib/api';
import { InterviewTimeFields } from './interview-fields';

/** Which of the catalogue's sentences a refused interview step says. */
export function interviewFailure(failure: unknown) {
  if (failure instanceof ApiError && failure.status === 0) return 'app.offline.body' as const;
  if (failure instanceof InterviewRefused && failure.reason === 'time_not_allowed') return 'app.interview.timeNotAllowed' as const;
  if (failure instanceof InterviewRefused && failure.reason === 'closed') return 'app.interview.closed' as const;
  return 'common.errorBody' as const;
}

const MODES: InterviewMode[] = ['office', 'phone', 'video'];
const DURATIONS = ['30', '45', '60'] as const;

/**
 * The company's invitation (migration 373): a day and a time in Cairo time,
 * how long, how — at the office with its address, by phone, by video with
 * its link — and a note. Sent, it replaces any invitation still standing.
 */
export function InviteSheet({
  visible,
  onClose,
  onDismiss,
  applicationId,
  name,
  now,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  applicationId: string;
  name: string;
  now: number;
}) {
  const t = useTranslations();
  const { invite } = useInterviewActions();
  const [day, setDay] = useState(() => nextCairoDays(new Date(now))[1] as string);
  const [time, setTime] = useState('11:00');
  const [minutes, setMinutes] = useState<(typeof DURATIONS)[number]>('30');
  const [mode, setMode] = useState<InterviewMode>('office');
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    setError(null);
    invite.mutate(
      {
        applicationId,
        startsAt: cairoInstant(day, time),
        minutes: Number(minutes),
        mode,
        place: mode === 'phone' ? null : place.trim() || null,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          toast.show({ message: t('app.interview.sent'), tone: 'success' });
          onClose();
        },
        onError: (failure) => setError(t(interviewFailure(failure))),
      },
    );
  };

  return (
    <FormSheet visible={visible} onClose={onClose} onDismiss={onDismiss} title={t('app.interview.inviteTitle', { name })} busy={invite.isPending}>
      <InterviewTimeFields now={now} day={day} time={time} onDay={setDay} onTime={setTime} />
      <Field label={t('app.interview.duration')}>
        <Segmented
          label={t('app.interview.duration')}
          options={DURATIONS.map((value) => ({
            value,
            label: value === '60' ? t('app.interview.min60') : t.markup(`app.interview.min${value}`, markupTags),
          }))}
          value={minutes}
          onChange={setMinutes}
        />
      </Field>
      <Field label={t('app.interview.mode')}>
        <Segmented
          label={t('app.interview.mode')}
          options={MODES.map((value) => ({ value, label: t(`app.interview.mode_${value}`) }))}
          value={mode}
          onChange={setMode}
        />
      </Field>
      {mode === 'phone' ? null : (
        <Field label={t(mode === 'office' ? 'app.interview.place_office' : 'app.interview.place_video')}>
          <TextField
            value={place}
            onChangeText={setPlace}
            accessibilityLabel={t(mode === 'office' ? 'app.interview.place_office' : 'app.interview.place_video')}
            ltr={mode === 'video'}
            autoCapitalize="none"
            keyboardType={mode === 'video' ? 'url' : 'default'}
            maxLength={300}
          />
        </Field>
      )}
      <Field label={t('app.interview.note')}>
        <TextField
          value={note}
          onChangeText={setNote}
          accessibilityLabel={t('app.interview.note')}
          multiline
          maxLength={500}
          style={{ minHeight: 72, textAlignVertical: 'top' }}
        />
      </Field>
      <Text variant="caption" tone="mutedForeground">
        {t('app.interview.stageHint')}
      </Text>
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={t('app.interview.send')} size="lg" loading={invite.isPending} onPress={send} />
    </FormSheet>
  );
}

/** The candidate's other time: a day and a time in Cairo time, sent as their answer. */
export function CounterSheet({
  visible,
  onClose,
  onDismiss,
  interviewId,
  now,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  interviewId: string;
  now: number;
}) {
  const t = useTranslations();
  const { answer } = useInterviewActions();
  const [day, setDay] = useState(() => nextCairoDays(new Date(now))[1] as string);
  const [time, setTime] = useState('11:00');
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    setError(null);
    answer.mutate(
      { id: interviewId, answer: 'counter', counterStartsAt: cairoInstant(day, time) },
      {
        onSuccess: () => {
          toast.show({ message: t('app.interview.answered'), tone: 'success' });
          onClose();
        },
        onError: (failure) => setError(t(interviewFailure(failure))),
      },
    );
  };
  return (
    <FormSheet visible={visible} onClose={onClose} onDismiss={onDismiss} title={t('app.interview.counterTitle')} busy={answer.isPending}>
      <InterviewTimeFields now={now} day={day} time={time} onDay={setDay} onTime={setTime} />
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={t('app.interview.counterSend')} size="lg" loading={answer.isPending} onPress={send} />
    </FormSheet>
  );
}
