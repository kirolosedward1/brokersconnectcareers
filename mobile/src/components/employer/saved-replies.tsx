import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { fillReply, type ReplyValues } from '@/lib/replies';
import type { SavedReplyRow } from '@/lib/supabase/database.types';
import { whatsappLink } from '@/lib/whatsapp';
import { toast } from '~/components/feedback/toast';
import { Segmented } from '~/components/ui/segmented';
import { SwitchRow } from '~/components/ui/settings-list';
import { useMessageApplicants } from '~/features/employer/bulk';
import { ReplyRefused, useReplies, useReplyActions } from '~/features/employer/replies';
import { Button } from '~/components/ui/button';
import { MessageCircle, Trash2, X } from '~/components/ui/lucide';
import { KeyboardRoom } from '~/components/ui/keyboard-room';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useListOwner } from '~/features/jobs/recent';
import { createLocalList } from '~/lib/local-list';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { dialog } from '~/lib/dialog';
import { useConfirmDiscard } from '~/lib/use-leave-guard';
import { useSheetFence } from '~/components/ui/sheet-fence';
import { appDirection } from '~/lib/direction';

export type SavedReply = { id: string; text: string };

/** The words put in for the applicant and the job, shown as they are typed. */
const TOKENS = { name: '{name}', job: '{job}' };
/** Every word a reply may stand in for (src/lib/replies.ts), shown as written. */
const VARIABLES = { name: '{name}', first_name: '{first_name}', job: '{job}', company: '{company}', stage: '{stage}' };

/** As many replies as a person kept on a phone, before they were kept on the account. */
const KEPT = 20;
const MAX_LENGTH = 1000;

/**
 * Replies kept on this phone before v1.1 Phase B (src/lib/local-list.ts):
 * read only to offer moving them to the account, then cleared.
 */
export const savedReplies = createLocalList<SavedReply>('bc.wa-replies.v1', {
  max: KEPT,
  idOf: (reply) => reply.id,
  valid: (item): item is SavedReply => Boolean(item && typeof (item as SavedReply).id === 'string' && typeof (item as SavedReply).text === 'string'),
});

/**
 * The sheet a message is chosen from (the SavedReplies board): the opener the
 * app writes first, then the team's replies and the person's own (migration
 * 374), each sent with a tap — on WhatsApp with the applicant's words put in
 * on the phone, or by email, filled by the email (src/lib/replies.ts) — and a
 * field to keep a new one: one's own, or, for an admin, the whole team's.
 * Replies still on this phone are offered for moving to the account once.
 */
export function SavedRepliesSheet({
  visible,
  onClose,
  onDismiss,
  phone,
  opener,
  values,
  applicationId,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  phone: string;
  opener: string;
  values: ReplyValues;
  /** For a reply sent by email. */
  applicationId: string;
}) {
  const t = useTranslations('app.replies');
  // The sheet keeps its touches from the row or card it is drawn in (sheet-fence.ts).
  const fence = useSheetFence();
  const tCommon = useTranslations('common');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const owner = useListOwner();
  const local = savedReplies.useItems(owner);
  const replies = useReplies(visible);
  const { save, remove } = useReplyActions();
  const email = useMessageApplicants();
  const [draft, setDraft] = useState('');
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [teamWide, setTeamWide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  // A reply half written: pulled down, the sheet stays and asks first (iOS hands the attempt to onRequestClose).
  const confirmDiscard = useConfirmDiscard();
  const writing = draft.trim() !== '';
  const requestClose = () => (writing ? confirmDiscard(onClose) : onClose());
  const isAdmin = replies.data?.isAdmin ?? false;

  const failure = (reason: unknown) =>
    reason instanceof ReplyRefused && reason.reason === 'unknown_variable'
      ? t('unknownVariable', { words: reason.detail ?? '' })
      : reason instanceof ReplyRefused && reason.reason === 'limit'
        ? t('limit')
        : tCommon('errorBody');

  const sendWhatsApp = (text: string) => {
    onClose();
    Linking.openURL(whatsappLink(phone, fillReply(text, values))).catch(() => {});
  };
  const sendEmail = (text: string) => {
    setError(null);
    email.mutate(
      { applicationIds: [applicationId], message: text },
      {
        onSuccess: () => {
          toast.show({ message: t('emailed'), tone: 'success' });
          onClose();
        },
        onError: () => setError(tCommon('errorBody')),
      },
    );
  };
  const keep = () => {
    const text = draft.trim().slice(0, MAX_LENGTH);
    if (!text) return;
    setError(null);
    save.mutate(
      { body: text, channel, teamWide: isAdmin && teamWide },
      { onSuccess: () => setDraft(''), onError: (reason) => setError(failure(reason)) },
    );
  };
  // The phone's replies, moved to the account as the person's own; cleared once all are kept.
  const moveLocal = () => {
    setMoving(true);
    setError(null);
    Promise.all(local.map((reply) => save.mutateAsync({ body: reply.text, channel: 'whatsapp', teamWide: false })))
      .then(() => savedReplies.clear(owner))
      .catch((reason: unknown) => setError(failure(reason)))
      .then(() => setMoving(false));
  };
  const confirmRemove = (reply: SavedReplyRow) =>
    dialog.alert(t('removeTitle'), reply.body.slice(0, 120), [
      { text: tCommon('cancel'), style: 'cancel' },
      { text: t('remove'), style: 'destructive', onPress: () => remove.mutate(reply.id, { onError: () => setError(tCommon('errorBody')) }) },
    ]);

  const card = (reply: SavedReplyRow, removable: boolean) => (
    <Reply
      key={reply.id}
      text={reply.channel === 'whatsapp' ? fillReply(reply.body, values) : reply.body}
      label={reply.channel === 'email' ? t('channelEmail') : undefined}
      sendLabel={reply.channel === 'email' ? t('sendEmail') : t('send')}
      busy={reply.channel === 'email' && email.isPending}
      onSend={() => (reply.channel === 'email' ? sendEmail(reply.body) : sendWhatsApp(reply.body))}
      onRemove={removable ? () => confirmRemove(reply) : undefined}
    />
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!writing} onRequestClose={requestClose} onDismiss={onDismiss}>
      <KeyboardRoom>
        <View style={{ flex: 1, direction: appDirection, backgroundColor: colors.background }} {...fence}>
          <View style={styles.header}>
            <Text weight="semibold" accessibilityRole="header" style={{ flexShrink: 1 }}>
              {t('title')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tCommon('close')}
              onPress={onClose}
              hitSlop={8}
              style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={22} color={colors.foreground} />
            </Pressable>
          </View>
          {/* The new reply's box is at the foot: the sheet makes room for the keyboard under it. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode="interactive"
            contentContainerStyle={{ padding: gutter, gap: space[3], paddingBottom: insets.bottom + space[6] }}
          >
            <Reply text={opener} label={t('opener')} sendLabel={t('send')} onSend={() => sendWhatsApp(opener)} />

            {local.length ? (
              <View style={{ gap: space[2], padding: space[3], ...corner('lg'), backgroundColor: colors.accent }}>
                <Text variant="small">{t('localFound')}</Text>
                <View style={{ alignItems: 'flex-start' }}>
                  <Button label={t('moveLocal')} variant="outline" size="sm" loading={moving} onPress={moveLocal} />
                </View>
              </View>
            ) : null}

            {replies.data?.team.length ? (
              <View style={{ gap: space[2] }}>
                <Text variant="small" weight="semibold" accessibilityRole="header">
                  {t('team')}
                </Text>
                {replies.data.team.map((reply) => card(reply, isAdmin))}
              </View>
            ) : null}
            {replies.data?.own.length ? (
              <View style={{ gap: space[2] }}>
                <Text variant="small" weight="semibold" accessibilityRole="header">
                  {t('own')}
                </Text>
                {replies.data.own.map((reply) => card(reply, true))}
              </View>
            ) : null}

            <View style={{ gap: space[2], marginTop: space[3] }}>
              <Text variant="small" weight="semibold" accessibilityRole="header">
                {t('new')}
              </Text>
              <TextField
                value={draft}
                onChangeText={setDraft}
                placeholder={t('placeholder', TOKENS)}
                accessibilityLabel={t('new')}
                multiline
                maxLength={MAX_LENGTH}
                style={{ minHeight: 72, paddingVertical: space[2], textAlignVertical: 'top' }}
              />
              <Text variant="caption" tone="mutedForeground">
                {t('variables', VARIABLES)}
              </Text>
              <Segmented
                label={t('channel')}
                options={[
                  { value: 'whatsapp' as const, label: t('channelWhatsApp') },
                  { value: 'email' as const, label: t('channelEmail') },
                ]}
                value={channel}
                onChange={setChannel}
              />
              {isAdmin ? (
                <SwitchRow label={t('teamWide')} hint={t('teamWideHint')} value={teamWide} onChange={setTeamWide} />
              ) : null}
              {error ? (
                <Text variant="small" tone="destructive" accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}
              <View style={{ alignItems: 'flex-start' }}>
                <Button label={t('keep')} variant="outline" size="sm" loading={save.isPending && !moving} disabled={!draft.trim()} onPress={keep} />
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardRoom>
    </Modal>
  );
}

function Reply({
  text,
  label,
  sendLabel,
  busy = false,
  onSend,
  onRemove,
}: {
  text: string;
  label?: string;
  sendLabel: string;
  busy?: boolean;
  onSend: () => void;
  onRemove?: () => void;
}) {
  const t = useTranslations('app.replies');
  const { colors } = useTheme();
  return (
    <View
      style={{
        gap: space[2],
        padding: space[4],
        ...corner('xl'),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      {label ? (
        <Text variant="caption" weight="semibold" tone="mutedForeground">
          {label}
        </Text>
      ) : null}
      <Text variant="small">{text}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <Button label={sendLabel} size="sm" loading={busy} icon={<MessageCircle size={16} color={colors.primaryForeground} />} onPress={onSend} />
        {onRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('remove')}
            onPress={onRemove}
            hitSlop={8}
            style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={18} color={colors.destructive} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
    paddingVertical: space[2],
  },
});
