import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, useWindowDimensions, View } from 'react-native';
import type { AlertButton } from 'react-native';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { registerDialogHost, type DialogRequest } from '~/lib/dialog';
import { appDirection } from '~/lib/direction';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * Where the app's alerts are drawn (src/lib/dialog.ts): one at a time, the
 * next waiting its turn, in the app's direction. Cancel comes first in the
 * reading order — on the right in Arabic, as iOS puts it on an iPhone set to
 * Arabic — and the action after it; three or more stack, Cancel last. An
 * alert with no buttons is told with one that closes it. Only a button
 * closes it, as with iOS's own: the shade around it takes no tap, and
 * Android's Back is Cancel, when there is one.
 */
export function DialogHost() {
  const [queue, setQueue] = useState<{ id: number; request: DialogRequest }[]>([]);
  const next = useRef(0);
  useEffect(
    () =>
      registerDialogHost((request) => {
        next.current += 1;
        const id = next.current;
        setQueue((waiting) => [...waiting, { id, request }]);
      }),
    [],
  );
  const current = queue[0];
  if (!current) return null;
  return <Dialog key={current.id} request={current.request} onDone={() => setQueue((waiting) => waiting.slice(1))} />;
}

/** Longer than the dialog's fade out. */
const DISMISS_MS = 450;

function Dialog({ request, onDone }: { request: DialogRequest; onDone: () => void }) {
  const t = useTranslations('common');
  const { colors, shadow } = useTheme();
  const { width } = useWindowDimensions();
  const given = request.buttons?.length ? request.buttons : [{ text: t('close') } satisfies AlertButton];
  const cancel = given.filter((button) => button.style === 'cancel');
  const others = given.filter((button) => button.style !== 'cancel');
  const stacked = given.length > 2;
  const buttons = stacked ? [...others, ...cancel] : [...cancel, ...others];

  // The button's own work runs once the dialog is gone: a screen it opens, or
  // the next question, is not presented over a dialog still closing.
  const [chosen, setChosen] = useState<AlertButton | null>(null);
  const finished = useRef(false);
  const finish = (button: AlertButton | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone();
    button?.onPress?.();
  };
  const press = (button: AlertButton) => {
    if (chosen) return;
    setChosen(button);
    // iOS says when the dialog has gone (onDismiss); elsewhere it is gone at
    // once. Never later than its fade, whatever iOS says: the answer is not lost.
    if (Platform.OS !== 'ios') finish(button);
    else setTimeout(() => finish(button), DISMISS_MS);
  };

  return (
    <Modal
      visible={!chosen}
      onDismiss={() => finish(chosen)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (cancel[0]) press(cancel[0]);
      }}
    >
      {/* A modal is a window of its own: the app's direction is given again. */}
      <View style={{ flex: 1, direction: appDirection, alignItems: 'center', justifyContent: 'center', padding: gutter, backgroundColor: 'rgba(5, 10, 25, 0.45)' }}>
        <View
          accessibilityViewIsModal
          testID="dialog"
          style={{
            width: Math.min(360, width - gutter * 2),
            padding: gutter,
            gap: space[4],
            ...corner('xxl'),
            backgroundColor: colors.card,
            boxShadow: shadow.raised,
          }}
        >
          <View style={{ gap: space[2] }}>
            <Text variant="headline" weight="bold" accessibilityRole="header">
              {request.title}
            </Text>
            {request.message ? <Text tone="mutedForeground">{request.message}</Text> : null}
          </View>
          <View style={{ flexDirection: stacked ? 'column' : 'row', gap: space[2] }}>
            {buttons.map((button, index) => (
              <Button
                key={`${index}-${button.text}`}
                label={button.text ?? t('close')}
                variant={button.style === 'cancel' ? 'secondary' : button.style === 'destructive' ? 'destructive' : 'primary'}
                onPress={() => press(button)}
                style={stacked ? undefined : { flex: 1 }}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}
