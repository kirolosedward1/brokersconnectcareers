import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { PIPELINE_STAGES } from '@/lib/application-stages';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { toast } from '~/components/feedback/toast';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { ChoiceRow } from '~/components/ui/settings-list';
import { Field } from '~/components/ui/field';
import { FormSheet } from '~/components/ui/form-sheet';
import { Check } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { ReasonTick } from '~/components/employer/reason-tick';
import { useReplies } from '~/features/employer/replies';
import { BulkRefused, DECLINE_REASONS, useBulkMove, useMessageApplicants, type DeclineReason } from '~/features/employer/bulk';
import type { Applicant } from '~/features/employer/applicants';
import { markupTags } from '~/i18n/rich';
import { ApiError } from '~/lib/api';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

type Failure = 'app.offline.body' | 'app.bulk.rateLimited' | 'common.errorBody';
const failureKey = (failure: unknown): Failure =>
  failure instanceof ApiError && failure.status === 0
    ? 'app.offline.body'
    : failure instanceof BulkRefused && (failure.reason === 'rate_limited' || failure.reason === 'rate_limit')
      ? 'app.bulk.rateLimited'
      : 'common.errorBody';

/** The tick a card shows while the inbox is in select mode; withdrawn applicants cannot be chosen. */
export function PickBox({ name, selected, onToggle }: { name: string; selected: boolean; onToggle: () => void }) {
  const t = useTranslations();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t('app.bulk.pick', { name })}
      onPress={onToggle}
      hitSlop={8}
      style={{ minHeight: hitTarget, minWidth: hitTarget, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          ...corner('md'),
          borderWidth: 1.5,
          borderColor: selected ? colors.primary : colors.input,
          backgroundColor: selected ? colors.primary : colors.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Check size={16} color={colors.primaryForeground} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * The inbox's select mode, held at the foot of the screen (the PipelineBulk
 * board): how many are chosen, and the three things done to all of them —
 * move to a stage, one message by email (decided: email only), or a decline
 * with a reason the employer chooses whether they read (the same tick as one
 * applicant's).
 */
export function BulkBar({ selected, onDone }: { selected: Applicant[]; onDone: () => void }) {
  const t = useTranslations();
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const moveSheet = useSheet();
  const messageSheet = useSheet();
  const declineSheet = useSheet();
  const count = selected.length;
  const items = selected.map((row) => ({ applicationId: row.id, from: row.status }));

  return (
    <View
      style={{
        position: 'absolute',
        start: gutter,
        end: gutter,
        bottom: Math.max(insets.bottom, space[3]) + space[2],
        gap: space[2],
        padding: space[3],
        ...corner('xl'),
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        boxShadow: shadow.raised,
      }}
    >
      <Text variant="small" weight="semibold" accessibilityLiveRegion="polite" testID="bulk-count">
        {t.markup('app.bulk.selected', { count, ...markupTags })}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Button label={t('app.bulk.move')} size="sm" disabled={!count} onPress={moveSheet.show} />
        <Button label={t('app.bulk.message')} variant="outline" size="sm" disabled={!count} onPress={messageSheet.show} />
        <Button label={t('app.bulk.decline')} variant="outline" size="sm" disabled={!count} onPress={declineSheet.show} />
        <Button label={t('app.bulk.done')} variant="ghost" size="sm" onPress={onDone} />
      </View>
      {moveSheet.mounted ? (
        <MoveSheet visible={moveSheet.open} onClose={() => moveSheet.hide()} onDismiss={moveSheet.onDismiss} items={items} onMoved={onDone} />
      ) : null}
      {messageSheet.mounted ? (
        <MessageSheet
          visible={messageSheet.open}
          onClose={() => messageSheet.hide()}
          onDismiss={messageSheet.onDismiss}
          ids={selected.map((row) => row.id)}
          onSent={onDone}
        />
      ) : null}
      {declineSheet.mounted ? (
        <DeclineSheet visible={declineSheet.open} onClose={() => declineSheet.hide()} onDismiss={declineSheet.onDismiss} items={items} onMoved={onDone} />
      ) : null}
    </View>
  );
}

type SheetProps = { visible: boolean; onClose: () => void; onDismiss?: () => void };
type Item = { applicationId: string; from: ApplicationStatus };

function useResultToast() {
  const t = useTranslations();
  return (counts: { moved: number; movedAlready: number; failed: number; reasonsNotKept: number; pendingApproval?: number }) => {
    const clean = !counts.movedAlready && !counts.failed;
    toast.show({
      message: clean
        ? t.markup('app.bulk.result', { moved: counts.moved, ...markupTags })
        : t.markup('app.bulk.resultSome', { moved: counts.moved, already: counts.movedAlready, failed: counts.failed, ...markupTags }),
      tone: clean ? 'success' : 'default',
    });
    if (counts.reasonsNotKept) toast.show({ message: t('app.applicants.reasonNotKept'), tone: 'destructive' });
    // Declines an admin approves here (migration 380): asked for, not made.
    if (counts.pendingApproval) toast.show({ message: t.markup('app.rules.declinesAsked', { count: counts.pendingApproval, ...markupTags }), tone: 'default' });
  };
}

function MoveSheet({ visible, onClose, onDismiss, items, onMoved }: SheetProps & { items: Item[]; onMoved: () => void }) {
  const t = useTranslations();
  const move = useBulkMove();
  const said = useResultToast();
  const [error, setError] = useState<string | null>(null);
  // Turning down has its own sheet, with the reason.
  const stages = PIPELINE_STAGES.filter((stage) => stage !== 'rejected');
  return (
    <FormSheet visible={visible} onClose={onClose} onDismiss={onDismiss} title={t('app.bulk.moveTitle')} busy={move.isPending}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('app.bulk.moveTitle')}>
        {stages.map((stage) => (
          <ChoiceRow
            key={stage}
            label={t(`applicationStatus.${stage}`)}
            selected={false}
            disabled={move.isPending}
            onPress={() => {
              setError(null);
              move.mutate(
                { items, status: stage },
                {
                  onSuccess: (counts) => {
                    said(counts);
                    onClose();
                    onMoved();
                  },
                  onError: (failure) => setError(t(failureKey(failure))),
                },
              );
            }}
          />
        ))}
      </View>
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </FormSheet>
  );
}

function MessageSheet({ visible, onClose, onDismiss, ids, onSent }: SheetProps & { ids: string[]; onSent: () => void }) {
  const t = useTranslations();
  const send = useMessageApplicants();
  const replies = useReplies(visible);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The saved replies kept for email (migration 374): one tap puts its words in the box; the email fills each applicant's.
  const saved = [...(replies.data?.team ?? []), ...(replies.data?.own ?? [])].filter((reply) => reply.channel === 'email');
  return (
    <FormSheet visible={visible} onClose={onClose} onDismiss={onDismiss} title={t('app.bulk.messageTitle')} busy={send.isPending}>
      <Text variant="small" tone="mutedForeground">
        {t('app.bulk.messageHint')}
      </Text>
      {saved.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {saved.map((reply) => (
            <Chip key={reply.id} label={reply.title || reply.body.slice(0, 32)} onPress={() => setMessage(reply.body)} />
          ))}
        </View>
      ) : null}
      <Field label={t('app.bulk.messageField')}>
        <TextField
          value={message}
          onChangeText={setMessage}
          accessibilityLabel={t('app.bulk.messageField')}
          multiline
          maxLength={1000}
          style={{ minHeight: 120, textAlignVertical: 'top' }}
        />
      </Field>
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('app.bulk.messageSend')}
        size="lg"
        loading={send.isPending}
        disabled={message.trim().length < 2}
        onPress={() => {
          setError(null);
          send.mutate(
            { applicationIds: ids, message: message.trim() },
            {
              onSuccess: (result) => {
                toast.show({ message: t.markup('app.bulk.messageResult', { sent: result.sent, ...markupTags }), tone: 'success' });
                onClose();
                onSent();
              },
              onError: (failure) => setError(t(failureKey(failure))),
            },
          );
        }}
      />
    </FormSheet>
  );
}

function DeclineSheet({ visible, onClose, onDismiss, items, onMoved }: SheetProps & { items: Item[]; onMoved: () => void }) {
  const t = useTranslations();
  const move = useBulkMove();
  const said = useResultToast();
  const [reason, setReason] = useState<DeclineReason>('experience');
  const [details, setDetails] = useState('');
  const [share, setShare] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The reason's own sentence, then whatever was added; "another reason" is only the details.
  const note = [reason === 'other' ? '' : t(`app.bulk.reason_${reason}`), details.trim()].filter(Boolean).join(' ');

  return (
    <FormSheet visible={visible} onClose={onClose} onDismiss={onDismiss} title={t('app.bulk.declineTitle')} busy={move.isPending}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('app.bulk.reason')}>
        {DECLINE_REASONS.map((value) => (
          <ChoiceRow key={value} label={t(`app.bulk.reason_${value}`)} selected={reason === value} onPress={() => setReason(value)} />
        ))}
      </View>
      <Field label={t('app.bulk.declineNote')}>
        <TextField
          value={details}
          onChangeText={setDetails}
          accessibilityLabel={t('app.bulk.declineNote')}
          multiline
          maxLength={300}
          style={{ minHeight: 64, textAlignVertical: 'top' }}
        />
      </Field>
      {/* The same tick as one applicant's reason (decided): on, they read it; off, it is the team's note. */}
      <ReasonTick shared={share} onChange={setShare} testID="bulk-reason-tick" />
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('app.bulk.declineSend')}
        variant="destructive"
        size="lg"
        loading={move.isPending}
        onPress={() => {
          setError(null);
          move.mutate(
            { items, status: 'rejected', decisionNote: note || null, shareReason: share },
            {
              onSuccess: (counts) => {
                said(counts);
                onClose();
                onMoved();
              },
              onError: (failure) => setError(t(failureKey(failure))),
            },
          );
        }}
      />
    </FormSheet>
  );
}
