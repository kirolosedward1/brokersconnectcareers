import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { canSaveJobs } from '@/lib/permissions';
import { toast, type Toast } from '~/components/feedback/toast';
import { Appear } from '~/components/motion/appear';
import { Button } from '~/components/ui/button';
import { Lock, NotebookPen, Pencil, Plus, Trash2, X } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useListOwner } from '~/features/jobs/recent';
import { cleanNote, deleteNote, jobNotes, keepNote, NOTE_MAX, useJobNote, type JobNote } from '~/features/saved/notes';
import { useSavedJobIds } from '~/features/saved/queries';
import { markupTags } from '~/i18n/rich';
import { appDirection } from '~/lib/direction';
import { haptic } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { useSheetFence } from '~/components/ui/sheet-fence';

/**
 * A private note on a saved listing, written in a small card at the foot of
 * the screen that rises with the keyboard: what it is about at the top, the
 * field (300 characters, counted as they go), Save, and Delete once there is
 * a note to delete. Saving says so; deleting offers Undo rather than asking
 * first. Typed and not saved, a tap on the shade only puts the keyboard away —
 * the words are not lost to a stray tap; the cross is the way out without
 * saving.
 */
export function NoteSheet({
  visible,
  onClose,
  onDismiss,
  jobId,
  jobTitle,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  jobId: string;
  jobTitle: string;
}) {
  const t = useTranslations('app.saved.notes');
  // The sheet keeps its touches from the row or card it is drawn in (sheet-fence.ts).
  const fence = useSheetFence();
  const tCommon = useTranslations('common');
  const tToast = useTranslations('app.toast');
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const owner = useListOwner();
  const note = useJobNote(jobId);
  // Null until the reader types: until then the field shows the note as it is kept.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? note?.text ?? '';
  const clean = cleanNote(text);
  const changed = clean !== (note?.text ?? '');
  const keyboard = useKeyboardShown();

  const deleted = (before: JobNote): Toast => ({
    message: t('deleted'),
    icon: Trash2,
    action: { label: tToast('undo'), onPress: () => jobNotes.add(owner, before) },
  });

  const save = () => {
    if (!changed) return;
    keepNote(owner, jobId, clean);
    haptic.tap();
    onClose();
    // Emptied and saved is the same as deleted, and says so.
    if (clean) toast.show({ message: t('saved'), icon: NotebookPen, tone: 'success' });
    else if (note) toast.show(deleted(note));
  };

  const remove = () => {
    if (!note) return;
    deleteNote(owner, jobId);
    haptic.tap();
    onClose();
    toast.show(deleted(note));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, direction: appDirection, justifyContent: 'flex-end', backgroundColor: 'rgba(5, 10, 25, 0.5)' }}
        {...fence}
      >
        {/* The shade beside the card, not around it, so VoiceOver reaches what is in the card. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tCommon('close')}
          onPress={() => (changed ? Keyboard.dismiss() : onClose())}
          style={StyleSheet.absoluteFill}
        />
        <Appear from="below" distance={40} duration={320}>
          <View
            style={{
              margin: space[3],
              marginBottom: keyboard ? space[3] : Math.max(insets.bottom, space[3]),
              padding: gutter,
              gap: space[3],
              ...corner('xxl'),
              backgroundColor: colors.card,
              boxShadow: shadow.raised,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
              <View style={[styles.mark, { backgroundColor: colors.secondary }]}>
                <NotebookPen size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="semibold" accessibilityRole="header">
                  {t('title')}
                </Text>
                <Text variant="small" tone="mutedForeground" numberOfLines={2}>
                  {jobTitle}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tCommon('close')}
                onPress={onClose}
                hitSlop={8}
                style={{ width: hitTarget, height: hitTarget, marginTop: -space[2], marginEnd: -space[2], alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={{ gap: space[1] }}>
              <TextField
                value={text}
                onChangeText={setDraft}
                accessibilityLabel={t('title')}
                accessibilityHint={t('private')}
                placeholder={t('placeholder')}
                multiline
                autoFocus
                maxLength={NOTE_MAX}
                style={{ minHeight: 96, maxHeight: 180, paddingVertical: space[3], textAlignVertical: 'top' }}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Lock size={12} color={colors.mutedForeground} />
                <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }}>
                  {t('private')}
                </Text>
                <Text
                  variant="caption"
                  tone={text.length >= NOTE_MAX ? 'warning' : 'mutedForeground'}
                  accessibilityLabel={t('countSpoken', { count: text.length, max: NOTE_MAX })}
                >
                  {t.markup('count', { count: text.length, max: NOTE_MAX, ...markupTags })}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <View style={{ flex: 1 }}>
                <Button label={tCommon('save')} disabled={!changed} onPress={save} />
              </View>
              {note ? (
                <Button
                  label={t('delete')}
                  variant="ghost"
                  icon={<Trash2 size={16} color={colors.destructive} />}
                  onPress={remove}
                  style={{ paddingHorizontal: space[3] }}
                />
              ) : null}
            </View>
          </View>
        </Appear>
      </KeyboardAvoidingView>
    </Modal>
  );
}


/** The host's way of opening the note sheet (NoteSheetHost), while one is drawn. */
const hosts = new Set<(target: { jobId: string; jobTitle: string }) => void>();

/** Open the note sheet for a listing, drawn once at the app's root. */
export function openNoteSheet(jobId: string, jobTitle: string) {
  for (const show of hosts) show({ jobId, jobTitle });
}

/**
 * Where the note sheet is drawn: once, beside the app's navigators, outside
 * every list. Drawn inside the saved card, it went with the card: the
 * keyboard rising resized the list, the list drew its rows again, and the
 * sheet vanished under the reader's fingers while the keyboard stayed up
 * over a list nobody could type into.
 */
export function NoteSheetHost() {
  const sheet = useSheet();
  const [target, setTarget] = useState<{ jobId: string; jobTitle: string } | null>(null);
  const show = useRef(sheet.show);
  useEffect(() => {
    show.current = sheet.show;
  });
  useEffect(() => {
    const open = (next: { jobId: string; jobTitle: string }) => {
      setTarget(next);
      show.current();
    };
    hosts.add(open);
    return () => {
      hosts.delete(open);
    };
  }, []);
  if (!sheet.mounted || !target) return null;
  return (
    <NoteSheet
      key={target.jobId}
      visible={sheet.open}
      onClose={() => {
        Keyboard.dismiss();
        sheet.hide();
      }}
      onDismiss={sheet.onDismiss}
      jobId={target.jobId}
      jobTitle={target.jobTitle}
    />
  );
}

/** Whether the keyboard is up: the card's foot stands off the home indicator only while it is not. */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

/**
 * The note as a line to tap: "Your note: …" in two lines at most, or the
 * offer to write one. `framed` draws it as a row of its own (the listing
 * page); unframed it sits in the saved card's tray.
 */
export function NoteLine({ note, onPress, framed = false, label }: { note: JobNote | null; onPress: () => void; framed?: boolean; label?: string }) {
  const t = useTranslations('app.saved.notes');
  const { colors } = useTheme();
  const offer = label ?? t('add');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={note ? `${t('prefix')} ${note.text}` : offer}
      accessibilityHint={note ? t('edit') : undefined}
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        ...(framed
          ? {
              paddingHorizontal: space[4],
              paddingVertical: space[2],
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.muted : colors.card,
            }
          : { flexShrink: 1, opacity: pressed ? 0.6 : 1 }),
      })}
    >
      <NotebookPen size={16} color={note ? colors.primary : colors.mutedForeground} />
      {note ? (
        <Text variant="small" numberOfLines={framed ? 4 : 2} style={{ flex: 1 }}>
          <Text variant="small" weight="semibold">{`${t('prefix')} `}</Text>
          {note.text}
        </Text>
      ) : (
        <Text variant="small" weight="medium" tone="mutedForeground" style={{ flex: 1 }}>
          {offer}
        </Text>
      )}
      {note ? <Pencil size={14} color={colors.mutedForeground} /> : <Plus size={16} color={colors.mutedForeground} />}
    </Pressable>
  );
}

/**
 * The listing page's "Your note" row, for a candidate who has it saved: the
 * note, or the offer to write one, opening the same sheet as the saved card.
 */
export function SavedJobNote({ jobId, title }: { jobId: string; title: string }) {
  const t = useTranslations('app.saved.notes');
  const { actor } = useSession();
  const { ids } = useSavedJobIds();
  const note = useJobNote(jobId);
  const shown = canSaveJobs(actor) && ids.has(jobId);
  if (!shown) return null;
  return <NoteLine note={note} onPress={() => openNoteSheet(jobId, title)} framed label={t('forListing')} />;
}

const styles = StyleSheet.create({
  mark: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
