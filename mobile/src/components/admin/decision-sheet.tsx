import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { isAdminErrorCode } from '@/lib/admin/errors';
import { toast } from '~/components/feedback/toast';
import { Button } from '~/components/ui/button';
import { KeyboardRoom } from '~/components/ui/keyboard-room';
import { CheckCheck, X } from '~/components/ui/lucide';
import { Notice } from '~/components/ui/notice';
import { useSheetFence } from '~/components/ui/sheet-fence';
import { Text } from '~/components/ui/text';
import { pullLever, useAfterLever, type Lever } from '~/features/admin/levers';
import { ApiError } from '~/lib/api';
import { appDirection } from '~/lib/direction';
import { haptic } from '~/lib/haptics';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { corner, font, gutter, hitTarget, space, type as scale } from '~/theme/tokens';

/** One decision, as the screen that offers it words it. */
export type Decision = {
  lever: Lever;
  title: string;
  /** What happens, and who is told. */
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Whether a reason is asked for: required where somebody is owed one (the database insists too). */
  reason: 'none' | 'optional' | 'required';
  /** Who reads the reason: "Note (sent to the company)". */
  reasonLabel?: string;
};

/** The shortest reason the admin functions accept (reason_required). */
const REASON_MIN = 3;
const REASON_MAX = 500;

/** Refusals that mean the screen is out of date: what is there now is read again. */
const MOVED = new Set(['invalid_transition', 'not_found', 'no_change', 'stale_version']);

/**
 * The confirmation every lever goes through — the website's ConfirmAction:
 * what is about to happen and who is told, the reason where somebody is owed
 * one, and the server's answer. Only an answer of `ok` closes it and says
 * "done"; a refusal keeps it open with the website's own sentence, and a
 * request that never came back says so and claims nothing.
 */
export function DecisionSheet({
  visible,
  onClose,
  onDismiss,
  decision,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  decision: Decision;
}) {
  const t = useTranslations();
  // The sheet keeps its touches from the row or card under it (sheet-fence.ts).
  const fence = useSheetFence();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const afterLever = useAfterLever();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tooShort = decision.reason === 'required' && text.trim().length < REASON_MIN;

  async function confirm() {
    if (pending) return;
    if (tooShort) {
      setError(t('admin.errors.reason_required'));
      return;
    }
    setError(null);
    setPending(true);
    const outcome = await pullLever(decision.lever, decision.reason === 'none' ? '' : text).then(
      (result) => ({ result, failure: null }),
      (failure: unknown) => ({ result: null, failure }),
    );
    setPending(false);

    const { result, failure } = outcome;
    if (!result) {
      // The request never came back, or never reached the action: nothing is
      // claimed, and the queue is read again to find out where things stand.
      setError(failure instanceof ApiError && failure.status !== 0 ? t('admin.errors.unknown') : t('admin.errors.network'));
      void afterLever();
      return;
    }
    if (!result.ok) {
      const code = result.error;
      if (code === 'mfa_required' || code === 'mfa_challenge') setError(t(`app.admin.door.${code}`));
      else setError(isAdminErrorCode(code) ? t(`admin.errors.${code}` as never) : t('admin.errors.unknown'));
      if (MOVED.has(code)) void afterLever();
      return;
    }

    haptic.success();
    Keyboard.dismiss();
    onClose();
    toast.show({ message: t('admin.doneWhat', { what: decision.title }), icon: CheckCheck, tone: 'success' });
    void afterLever();
  }

  return (
    <Modal visible={visible} onDismiss={onDismiss} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardRoom>
        <View style={{ flex: 1, direction: appDirection, backgroundColor: colors.background }} {...fence}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              paddingHorizontal: gutter,
              paddingVertical: space[2],
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              disabled={pending}
              hitSlop={8}
              style={{ minWidth: hitTarget, minHeight: hitTarget, marginStart: -(hitTarget - 22) / 2, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={22} color={colors.foreground} />
            </Pressable>
            <Text weight="semibold" accessibilityRole="header" style={{ flex: 1 }}>
              {decision.title}
            </Text>
          </View>

          <ScrollView
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: gutter, gap: space[5], paddingBottom: insets.bottom + space[6] }}
          >
            {decision.body ? <Text>{decision.body}</Text> : null}

            {decision.reason !== 'none' ? (
              <View style={{ gap: space[1] }}>
                <Text variant="small" weight="medium">
                  {`${decision.reasonLabel ?? t('admin.reasonLabel')}${decision.reason === 'optional' ? ` (${t('common.optional')})` : ''}`}
                </Text>
                <TextInput
                  value={text}
                  onChangeText={(next) => {
                    setText(next);
                    if (error) setError(null);
                  }}
                  accessibilityLabel={decision.reasonLabel ?? t('admin.reasonLabel')}
                  multiline
                  maxLength={REASON_MAX}
                  textAlignVertical="top"
                  keyboardAppearance={scheme}
                  placeholderTextColor={colors.mutedForeground}
                  selectionColor={colors.primary}
                  editable={!pending}
                  style={{
                    minHeight: 96,
                    padding: space[3],
                    ...corner('lg'),
                    borderWidth: 1,
                    borderColor: colors.input,
                    backgroundColor: colors.card,
                    color: colors.foreground,
                    fontFamily: font.regular,
                    fontSize: scale.body.fontSize,
                    // The physical edge, as in TextField: a field's text is not mirrored for right to left.
                    textAlign: appDirection === 'rtl' ? 'right' : 'left',
                  }}
                />
                {decision.reason === 'required' ? (
                  <Text variant="caption" tone="mutedForeground">
                    {t('admin.errors.reason_required')}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {error ? <Notice tone="destructive">{error}</Notice> : null}

            <Button
              label={decision.confirmLabel}
              size="lg"
              variant={decision.destructive ? 'destructive' : 'primary'}
              loading={pending}
              disabled={tooShort && !pending}
              onPress={confirm}
            />
            <Button label={t('common.cancel')} variant="ghost" disabled={pending} onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardRoom>
    </Modal>
  );
}

/** The host's way of opening the sheet (DecisionSheetHost), while one is drawn. */
const hosts = new Set<(decision: Decision) => void>();

/** Ask for one decision, in the sheet drawn once at the app's root. */
export function openDecision(decision: Decision) {
  for (const show of hosts) show(decision);
}

/**
 * Where the decision sheet is drawn: once, beside the app's navigators, not
 * in the queue's cards — a card drawn again when its queue is read again
 * would take the sheet, and the reason half typed in it, with it.
 */
export function DecisionSheetHost() {
  const sheet = useSheet();
  const [decision, setDecision] = useState<{ id: number; decision: Decision } | null>(null);
  const show = useRef(sheet.show);
  const next = useRef(0);
  useEffect(() => {
    show.current = sheet.show;
  });
  useEffect(() => {
    const open = (asked: Decision) => {
      next.current += 1;
      setDecision({ id: next.current, decision: asked });
      show.current();
    };
    hosts.add(open);
    return () => {
      hosts.delete(open);
    };
  }, []);
  if (!sheet.mounted || !decision) return null;
  return (
    <DecisionSheet
      // A new decision starts with an empty reason and no error.
      key={decision.id}
      visible={sheet.open}
      onClose={() => {
        Keyboard.dismiss();
        sheet.hide();
      }}
      onDismiss={sheet.onDismiss}
      decision={decision.decision}
    />
  );
}
