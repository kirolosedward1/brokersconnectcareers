import { useState } from 'react';
import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { MessageSquareReply } from '~/components/ui/lucide';
import { formatDate } from '@/lib/format';
import type { AppealRefusal } from '@/lib/mobile-api/contract';
import type { AppealSubjectType } from '@/lib/supabase/database.types';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { AppealRefused, useAppealState, useSubmitAppeal } from '~/features/moderation/appeals';
import { ApiError } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

const REFUSAL_COPY = {
  message_required: 'messageRequired',
  not_appealable: 'notAppealable',
  appeal_open: 'alreadyOpen',
  appeal_limit: 'limit',
  appeal_too_soon: 'tooSoon',
  rate_limit: 'rateLimit',
  company_suspended: 'companySuspended',
  unavailable: 'unavailable',
} as const satisfies Record<AppealRefusal, string>;

/**
 * "Ask for a review", under the decision it is about — the website's
 * AppealPanel. Not a ticket system: one message in, one answer out, and the
 * answer arrives as a notification. So it shows one of three things — the
 * form (when the database says this person may appeal), the appeal already
 * waiting, or the last answer — and nothing when appealing is not possible.
 */
export function AppealPanel({ subjectType, subjectId }: { subjectType: AppealSubjectType; subjectId: string }) {
  const t = useTranslations('appeals');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { colors } = useTheme();
  const state = useAppealState(subjectType, subjectId).data ?? null;
  const submit = useSubmitAppeal();

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!state) return null;

  if (submit.isSuccess) {
    return (
      <Text variant="small" tone="success" accessibilityLiveRegion="polite">
        {t('sent')}
      </Text>
    );
  }

  const send = () => {
    if (message.trim().length < 10) {
      setError(t('messageRequired'));
      return;
    }
    setError(null);
    submit.mutate(
      { subjectType, subjectId, message: message.trim() },
      {
        onError: (failure) => {
          // Never came back: nothing is claimed, and the words stay in the box.
          if (failure instanceof ApiError && failure.status === 0) return setError(t('network'));
          const reason = failure instanceof AppealRefused ? failure.reason : 'failed';
          setError(reason === 'failed' ? tCommon('errorBody') : t(REFUSAL_COPY[reason]));
        },
      },
    );
  };

  return (
    <View style={{ gap: space[2], marginTop: space[2] }}>
      {state.open ? (
        <Text variant="small">{t('waiting', { date: formatDate(state.open.created_at, locale) })}</Text>
      ) : null}

      {!state.open && state.last?.status === 'upheld' ? (
        <View style={{ borderStartWidth: 2, borderStartColor: colors.border, paddingStart: space[3], gap: 2 }}>
          <Text variant="small">{t('stands', { date: formatDate(state.last.decided_at, locale) })}</Text>
          {state.last.note ? (
            <Text variant="small" tone="mutedForeground">
              {`«${state.last.note}»`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {state.appealable && !open ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={t('ask')}
            variant="outline"
            size="sm"
            icon={<MessageSquareReply size={16} color={colors.foreground} />}
            onPress={() => setOpen(true)}
          />
        </View>
      ) : null}

      {state.appealable && open ? (
        <View style={{ gap: space[3] }}>
          <Field label={t('label')} hint={t('hint')} error={error}>
            <TextField
              value={message}
              onChangeText={setMessage}
              accessibilityLabel={t('label')}
              multiline
              maxLength={1000}
              style={{ minHeight: 88, paddingVertical: space[2], textAlignVertical: 'top' }}
            />
          </Field>
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <Button label={t('send')} size="sm" loading={submit.isPending} onPress={send} />
            <Button label={tCommon('cancel')} size="sm" variant="ghost" disabled={submit.isPending} onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : null}

      {error && !open ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
