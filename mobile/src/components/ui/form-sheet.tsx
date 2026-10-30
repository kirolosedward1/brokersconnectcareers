import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { KeyboardRoom } from '~/components/ui/keyboard-room';
import { X } from '~/components/ui/lucide';
import { useSheetFence } from '~/components/ui/sheet-fence';
import { Text } from '~/components/ui/text';
import { appDirection } from '~/lib/direction';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';

/**
 * A short form in a page sheet: its title and a way to close at the top, the
 * fields scrolling under it with room made for the keyboard. Swiping it away
 * is refused while its send is on its way. Shown through useSheet().
 */
export function FormSheet({
  visible,
  onClose,
  onDismiss,
  title,
  busy,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  title: string;
  busy: boolean;
  children: ReactNode;
}) {
  const t = useTranslations();
  const fence = useSheetFence();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={onClose} onDismiss={onDismiss}>
      <KeyboardRoom>
        <View style={{ flex: 1, direction: appDirection, backgroundColor: colors.background }} {...fence}>
          <View style={styles.header}>
            <Text weight="semibold" accessibilityRole="header" style={{ flexShrink: 1 }}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              hitSlop={8}
              style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode="interactive"
            contentContainerStyle={{ padding: gutter, gap: space[4], paddingBottom: insets.bottom + space[6] }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardRoom>
    </Modal>
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
