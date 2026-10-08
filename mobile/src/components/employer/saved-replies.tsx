import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { whatsappLink } from '@/lib/whatsapp';
import { Button } from '~/components/ui/button';
import { MessageCircle, Trash2, X } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useListOwner } from '~/features/jobs/recent';
import { createLocalList } from '~/lib/local-list';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

export type SavedReply = { id: string; text: string };

/** The words put in for the applicant and the job, shown as they are typed. */
const TOKENS = { name: '{name}', job: '{job}' };

/** As many replies as a person keeps to hand. */
const KEPT = 20;
const MAX_LENGTH = 1000;

/**
 * Replies a company sends again and again on WhatsApp — "we'd like to meet
 * you on…", "thank you, the role is filled" — kept on this phone for the
 * person who wrote them (src/lib/local-list.ts). `{name}` and `{job}` in one
 * become the applicant's name and the listing's title when it is sent.
 */
export const savedReplies = createLocalList<SavedReply>('bc.wa-replies.v1', {
  max: KEPT,
  idOf: (reply) => reply.id,
  valid: (item): item is SavedReply => Boolean(item && typeof (item as SavedReply).id === 'string' && typeof (item as SavedReply).text === 'string'),
});

/** A reply with the applicant's name and the listing's title put in. */
export function fillReply(text: string, values: { name: string; job: string }): string {
  return text.replaceAll('{name}', values.name).replaceAll('{job}', values.job);
}

/**
 * The sheet a WhatsApp message is chosen from: the opener the app writes
 * (`opener`) first, then the saved replies, each sent with a tap; and a field
 * to write and keep a new one. Removing one asks first.
 */
export function SavedRepliesSheet({
  visible,
  onClose,
  phone,
  opener,
  values,
}: {
  visible: boolean;
  onClose: () => void;
  phone: string;
  opener: string;
  values: { name: string; job: string };
}) {
  const t = useTranslations('app.replies');
  const tCommon = useTranslations('common');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const owner = useListOwner();
  const replies = savedReplies.useItems(owner);
  const [draft, setDraft] = useState('');

  const send = (text: string) => {
    onClose();
    Linking.openURL(whatsappLink(phone, text)).catch(() => {});
  };
  const keep = () => {
    const text = draft.trim().slice(0, MAX_LENGTH);
    if (!text) return;
    savedReplies.add(owner, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text });
    setDraft('');
  };
  const remove = (reply: SavedReply) =>
    Alert.alert(t('removeTitle'), reply.text.slice(0, 120), [
      { text: tCommon('cancel'), style: 'cancel' },
      { text: t('remove'), style: 'destructive', onPress: () => savedReplies.remove(owner, reply.id) },
    ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
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
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: gutter, gap: space[3], paddingBottom: insets.bottom + space[6] }}
        >
          <Reply text={opener} label={t('opener')} onSend={() => send(opener)} />
          {replies.map((reply) => (
            <Reply key={reply.id} text={fillReply(reply.text, values)} onSend={() => send(fillReply(reply.text, values))} onRemove={() => remove(reply)} />
          ))}

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
              {t('tokens', TOKENS)}
            </Text>
            <View style={{ alignItems: 'flex-start' }}>
              <Button label={t('keep')} variant="outline" size="sm" disabled={!draft.trim()} onPress={keep} />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Reply({ text, label, onSend, onRemove }: { text: string; label?: string; onSend: () => void; onRemove?: () => void }) {
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
        <Button label={t('send')} size="sm" icon={<MessageCircle size={16} color={colors.primaryForeground} />} onPress={onSend} />
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
