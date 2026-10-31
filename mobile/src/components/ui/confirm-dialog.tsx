import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { appDirection } from '~/lib/direction';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * A question with two answers, drawn by the app in its own direction: the
 * words where Arabic starts, Cancel on the right and the action on the left.
 *
 * iOS's own alert (src/lib/dialog.ts) is laid out in the phone's language, so
 * on an English iPhone, and in Expo Go, an Arabic question stood at the left
 * (owner's call, 31 Oct: fix it). This one is for a screen in a tab, never
 * inside a sheet: a sheet of its own cannot be shown over another sheet
 * (dialog.ts says why), which is where iOS's alert stays.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message?: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.scrim, { direction: appDirection, backgroundColor: colors.scrim }]}>
        {/* A tap outside is Cancel, as the system's own alert has no outside to tap but a sheet's does. */}
        <Pressable accessibilityElementsHidden importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={{ ...corner('xl'), backgroundColor: colors.card, padding: space[5], gap: space[4], width: '100%', maxWidth: 400 }}
        >
          <View style={{ gap: space[2] }}>
            <Text variant="headline" weight="semibold" accessibilityRole="header">
              {title}
            </Text>
            {message ? (
              <Text variant="small" tone="mutedForeground">
                {message}
              </Text>
            ) : null}
          </View>
          {/* In the reading order: Cancel first, where Arabic starts (the right). */}
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <View style={{ flex: 1 }}>
              <Button testID="confirm-cancel" label={cancelLabel} variant="outline" onPress={onCancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID="confirm-action"
                label={confirmLabel}
                variant={destructive ? 'destructive' : 'primary'}
                onPress={onConfirm}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: gutter,
  },
});
