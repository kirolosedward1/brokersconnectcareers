import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import type { ApplicationNoteRow, ApplicationStatus } from '@/lib/supabase/database.types';
import { toast } from '~/components/feedback/toast';
import { Appear } from '~/components/motion/appear';
import { ProgressBar } from '~/components/motion/progress-bar';
import { Button } from '~/components/ui/button';
import { BackChevron, ForwardChevron } from '~/components/ui/icons';
import { UserRoundCheck, UserRoundX, X } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { MovedAlready, useSetApplicationStatus, type Applicant } from '~/features/employer/applicants';
import { markupTags } from '~/i18n/rich';
import { appDirection } from '~/lib/direction';
import { dialog } from '~/lib/dialog';
import { haptic } from '~/lib/haptics';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';
import { ApplicantCard } from './applicant-card';

type CardProps = {
  jobTitleOf: (applicant: Applicant) => string;
  companyName: string;
  districtNamesOf: (applicant: Applicant) => string[];
  notesOf: (applicant: Applicant) => ApplicationNoteRow[] | undefined;
  authors: Record<string, string>;
  viewerId: string | null;
};

/**
 * The inbox one applicant at a time, full height, with the two moves an
 * employer makes most — shortlist, turn down — held at the foot of the
 * screen, and the next applicant brought in as soon as one is decided. The
 * order is the inbox's as it was when the review began: an applicant moved
 * out of the stage being reviewed stays where they were in it, so nobody is
 * skipped. Everything else (the CV, WhatsApp, notes, the stage picker) is the
 * applicant's own card.
 */
export function ApplicantReview({
  visible,
  onClose,
  onDismiss,
  queue,
  rows,
  ...card
}: CardProps & {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  /** The applicants' ids, in the order the review began with. */
  queue: string[];
  /** The inbox as read now: the latest of each applicant. */
  rows: Applicant[];
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const move = useSetApplicationStatus();
  const [index, setIndex] = useState(0);
  // Which way the last step went, for the side the next card comes in from.
  const [forward, setForward] = useState(true);
  // The latest read of each, and the one held from the start for anybody the inbox no longer lists.
  const [kept] = useState(() => new Map(rows.map((row) => [row.id, row])));
  const latest = new Map(rows.map((row) => [row.id, row]));
  const id = queue[Math.min(index, queue.length - 1)];
  const applicant = (id && (latest.get(id) ?? kept.get(id))) || null;
  const total = queue.length;
  const last = index >= total - 1;

  const go = (step: 1 | -1) => {
    const next = index + step;
    if (next < 0) return;
    if (next >= total) {
      toast.show({ message: t('app.review.done'), tone: 'success' });
      onClose();
      return;
    }
    haptic.selection();
    setForward(step > 0);
    setIndex(next);
  };

  const decide = (status: ApplicationStatus) => {
    if (!applicant) return;
    const name = applicant.candidate?.full_name ?? '—';
    const from = applicant.status;
    // Answered even after the review has closed (the last one decided closes it).
    move
      .mutateAsync({ applicationId: applicant.id, status, decisionNote: '', from })
      .then(() => {
        haptic.success();
        toast.show({
          message: t(status === 'shortlisted' ? 'app.review.shortlisted' : 'app.review.rejected', { name }),
          icon: status === 'shortlisted' ? UserRoundCheck : UserRoundX,
          tone: status === 'shortlisted' ? 'success' : 'default',
        });
      })
      .catch((failure: unknown) =>
        toast.show({ message: failure instanceof MovedAlready ? t('app.review.moved') : t('common.errorBody'), icon: UserRoundX }),
      );
    // Decided: the next one comes in while the move is on its way.
    go(1);
  };

  const turnDown = () => {
    if (!applicant) return;
    dialog.alert(t('app.applicants.rejectConfirm'), applicant.candidate?.full_name ?? undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('app.review.reject'), style: 'destructive', onPress: () => decide('rejected') },
    ]);
  };

  const status = applicant?.status;
  const canShortlist = status === 'new';
  const canTurnDown = status !== undefined && status !== 'rejected' && status !== 'hired';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={{ flex: 1, direction: appDirection, backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            hitSlop={10}
            style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={20} color={colors.foreground} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center', gap: space[1] }}>
            <Text weight="semibold" accessibilityRole="header">
              {t('app.review.title')}
            </Text>
            <Text variant="caption" tone="mutedForeground">
              {t.markup('app.review.progress', { current: Math.min(index + 1, total), total, ...markupTags })}
            </Text>
          </View>
          <View style={{ width: hitTarget }} />
        </View>
        <View style={{ paddingHorizontal: gutter, paddingTop: space[2] }}>
          <ProgressBar value={total ? (index + 1) / total : 0} label={t.markup('app.review.progress', { current: index + 1, total, ...markupTags })} />
        </View>

        <ScrollView contentContainerStyle={{ padding: gutter, paddingBottom: space[6] }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {applicant ? (
            <Appear key={applicant.id} from={forward ? 'end' : 'start'} distance={40} duration={300}>
              <ApplicantCard
                applicant={applicant}
                jobTitle={card.jobTitleOf(applicant)}
                companyName={card.companyName}
                districtNames={card.districtNamesOf(applicant)}
                notes={card.notesOf(applicant)}
                authors={card.authors}
                viewerId={card.viewerId}
              />
            </Appear>
          ) : null}
        </ScrollView>

        {/* The moves, held where a thumb is. */}
        <View
          style={{
            gap: space[2],
            paddingHorizontal: gutter,
            paddingTop: space[3],
            paddingBottom: Math.max(insets.bottom, space[3]),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t('app.review.reject')}
                variant="outline"
                size="lg"
                disabled={!canTurnDown}
                icon={<UserRoundX size={18} color={canTurnDown ? colors.destructive : colors.mutedForeground} />}
                onPress={turnDown}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={canShortlist ? t('app.review.shortlist') : last ? t('app.review.done') : t('app.review.next')}
                size="lg"
                icon={canShortlist ? <UserRoundCheck size={18} color={colors.primaryForeground} /> : undefined}
                onPress={() => (canShortlist ? decide('shortlisted') : go(1))}
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('app.review.previous')}
              disabled={index === 0}
              onPress={() => go(-1)}
              hitSlop={8}
              style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: space[1], opacity: index === 0 ? 0.35 : 1 }}
            >
              <BackChevron size={16} color={colors.primary} />
              <Text variant="small" weight="semibold" tone="primary">
                {t('app.review.previous')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={last ? t('app.review.done') : t('app.review.next')}
              onPress={() => go(1)}
              hitSlop={8}
              style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: space[1] }}
            >
              <Text variant="small" weight="semibold" tone="primary">
                {last ? t('app.review.done') : t('app.review.next')}
              </Text>
              <ForwardChevron size={16} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[2],
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

