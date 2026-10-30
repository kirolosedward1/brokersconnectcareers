import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { Field } from '~/components/ui/field';
import { FormSheet } from '~/components/ui/form-sheet';
import { Notice } from '~/components/ui/notice';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import type { TeamMember } from '~/features/employer/company';
import {
  CLOSURE_DAYS,
  ClosureRefused,
  useCancelDeletion,
  useRequestDeletion,
  useSetPurge,
  useTransferOwnership,
  type CompanyClosure,
} from '~/features/employer/closure';
import { ApiError } from '~/lib/api';
import { dialog } from '~/lib/dialog';
import { useSheet } from '~/lib/use-sheet';
import { space } from '~/theme/tokens';

const PURGES = [
  { days: null, key: 'purgeDefault' },
  { days: 180, key: 'purgeSixMonths' },
  { days: 90, key: 'purgeThreeMonths' },
  { days: 30, key: 'purgeMonth' },
] as const;

type Failure = 'app.offline.body' | 'common.errorBody';
const failureKey = (failure: unknown): Failure =>
  failure instanceof ApiError && failure.status === 0 ? 'app.offline.body' : 'common.errorBody';

/**
 * The company's own account (Phase B 07c): how long the applications to an
 * ended listing are kept (any admin), and, for the owner alone, handing the
 * company to a member and deleting it — hidden at once, gone after 14 days
 * unless cancelled, each applicant keeping a record.
 */
export function OwnershipSettings({
  companyName,
  team,
  isOwner,
  closure,
}: {
  companyName: string;
  team: TeamMember[];
  isOwner: boolean;
  closure: CompanyClosure;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const purge = useSetPurge();
  const transfer = useTransferOwnership();
  const cancel = useCancelDeletion();
  const deleteSheet = useSheet();
  const [purgeDays, setPurgeDays] = useState(closure.purgeAfterDays);
  const [heir, setHeir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const colleagues = team.filter((member) => !member.isOwner);

  if (closure.closedAt) {
    return (
      <Notice tone="warning" title={t('app.closure.closedTitle')}>
        {t('app.closure.closedBody')}
      </Notice>
    );
  }

  const goesOn = closure.deletionRequestedAt
    ? formatDate(new Date(new Date(closure.deletionRequestedAt).getTime() + CLOSURE_DAYS * 24 * 60 * 60 * 1000), locale)
    : null;

  const choosePurge = (days: CompanyClosure['purgeAfterDays']) => {
    const before = purgeDays;
    setPurgeDays(days);
    setError(null);
    purge.mutate(
      { days },
      {
        onError: (failure) => {
          setPurgeDays(before);
          setError(t(failureKey(failure)));
        },
      },
    );
  };

  const handOver = () => {
    const member = colleagues.find((person) => person.userId === heir);
    if (!member) return;
    const name = member.name ?? '—';
    dialog.alert(t('app.closure.transferConfirmTitle', { name }), t('app.closure.transferConfirmBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('app.closure.transfer'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          transfer.mutate(
            { userId: member.userId },
            {
              onSuccess: () => setHeir(null),
              onError: (failure) =>
                setError(
                  failure instanceof ClosureRefused && failure.reason === 'not_eligible'
                    ? t('app.closure.transferNotEligible')
                    : t(failureKey(failure)),
                ),
            },
          );
        },
      },
    ]);
  };

  return (
    <Card style={{ gap: space[5] }}>
      <View style={{ gap: space[1] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('app.closure.title')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('app.closure.body')}
        </Text>
      </View>

      <View style={{ gap: space[2] }}>
        <Text variant="small" weight="medium">
          {t('app.closure.purgeTitle')}
        </Text>
        <Text variant="caption" tone="mutedForeground">
          {t('app.closure.purgeHint')}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('app.closure.purgeTitle')}
          contentContainerStyle={{ gap: space[2] }}
        >
          {PURGES.map((choice) => (
            <Chip
              key={choice.key}
              radio
              label={t(`app.closure.${choice.key}`)}
              selected={purgeDays === choice.days}
              disabled={purge.isPending}
              onPress={() => choosePurge(choice.days)}
            />
          ))}
        </ScrollView>
      </View>

      {isOwner && !closure.deletionRequestedAt ? (
        <View style={{ gap: space[2] }}>
          <Text variant="small" weight="medium">
            {t('app.closure.transferTitle')}
          </Text>
          {colleagues.length ? (
            <>
              <Field label={t('app.closure.transferTo')} hint={t('app.closure.transferHint')}>
                <Select
                  label={t('app.closure.transferTo')}
                  value={heir}
                  placeholder={t('app.closure.transferPick')}
                  options={colleagues.map((member) => ({ value: member.userId, label: member.name ?? '—' }))}
                  onChange={setHeir}
                />
              </Field>
              <View style={{ alignItems: 'flex-start' }}>
                <Button label={t('app.closure.transfer')} variant="outline" disabled={!heir} loading={transfer.isPending} onPress={handOver} />
              </View>
            </>
          ) : (
            <Text variant="caption" tone="mutedForeground">
              {t('app.closure.transferNobody')}
            </Text>
          )}
        </View>
      ) : null}

      {isOwner ? (
        closure.deletionRequestedAt ? (
          <View style={{ gap: space[3] }}>
            <Notice tone="warning" title={t('app.closure.closingTitle')}>
              {t('app.closure.closingBody', { date: goesOn ?? '' })}
            </Notice>
            <View style={{ alignItems: 'flex-start' }}>
              <Button
                label={t('app.closure.cancel')}
                loading={cancel.isPending}
                onPress={() => {
                  setError(null);
                  cancel.mutate({} as Record<string, never>, { onError: (failure) => setError(t(failureKey(failure))) });
                }}
              />
            </View>
          </View>
        ) : (
          <View style={{ gap: space[2] }}>
            <Text variant="small" weight="medium">
              {t('app.closure.deleteTitle')}
            </Text>
            <Text variant="caption" tone="mutedForeground">
              {t('app.closure.deleteHint')}
            </Text>
            <View style={{ alignItems: 'flex-start' }}>
              <Button label={t('app.closure.delete')} variant="destructive" onPress={deleteSheet.show} />
            </View>
          </View>
        )
      ) : null}

      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {deleteSheet.mounted ? (
        <DeleteSheet visible={deleteSheet.open} onClose={() => deleteSheet.hide()} onDismiss={deleteSheet.onDismiss} companyName={companyName} />
      ) : null}
    </Card>
  );
}

/** What deleting does, said before it is done, and the company's name typed back to do it. */
function DeleteSheet({
  visible,
  onClose,
  onDismiss,
  companyName,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  companyName: string;
}) {
  const t = useTranslations();
  const request = useRequestDeletion();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === companyName.trim();
  return (
    <FormSheet visible={visible} onClose={onClose} onDismiss={onDismiss} title={t('app.closure.deleteSheetTitle')} busy={request.isPending}>
      {(['deleteWhat1', 'deleteWhat2', 'deleteWhat3', 'deleteWhat4'] as const).map((key) => (
        <Text key={key} variant="small">
          {`• ${t(`app.closure.${key}`)}`}
        </Text>
      ))}
      <Field label={t('app.closure.deleteConfirmLabel', { name: companyName })} error={error}>
        <TextField value={typed} onChangeText={setTyped} accessibilityLabel={t('app.closure.deleteConfirmLabel', { name: companyName })} autoCorrect={false} />
      </Field>
      <Button
        label={t('app.closure.deleteConfirm')}
        variant="destructive"
        disabled={!matches}
        loading={request.isPending}
        onPress={() => {
          setError(null);
          request.mutate(
            { confirmName: typed.trim() },
            {
              onSuccess: () => onClose(),
              onError: (failure) =>
                setError(
                  failure instanceof ClosureRefused && failure.fieldErrors?.confirmName
                    ? t('app.closure.deleteMismatch')
                    : t(failureKey(failure)),
                ),
            },
          );
        }}
      />
    </FormSheet>
  );
}
