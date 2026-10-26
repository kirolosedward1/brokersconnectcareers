import type { ComponentType, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { Appear } from '~/components/motion/appear';
import type { LucideProps } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { appDirection } from '~/lib/direction';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { useSheetFence } from '~/components/ui/sheet-fence';

export type MenuItem = {
  label: string;
  icon: ComponentType<LucideProps>;
  /** Run once the menu has gone: free to open an alert or a sheet. */
  onPress: () => void;
  destructive?: boolean;
};

/**
 * What a held card offers, as a card at the foot of the screen over a dimmed
 * page: what it is about at the top (`header`), then each thing to do with
 * its icon. Choosing closes it first and does the thing once it has gone, so
 * an alert or a share sheet it opens is presented (sheet.hide(after)).
 *
 * Never taller than the screen: at the accessibility text sizes a listing's
 * whole title in the header, with the items under it, outgrew a small phone,
 * and what went off its top could not be reached. Then it scrolls.
 */
export function ActionMenu({
  visible,
  onClose,
  onDismiss,
  header,
  items,
}: {
  visible: boolean;
  /** Closes it, then runs `after` once it has gone (useSheet's hide). */
  onClose: (after?: () => void) => void;
  onDismiss: () => void;
  header?: ReactNode;
  items: MenuItem[];
}) {
  const t = useTranslations('common');
  // The sheet keeps its touches from the row or card it is drawn in (sheet-fence.ts).
  const fence = useSheetFence();
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const marginBottom = Math.max(insets.bottom, space[3]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onClose()} onDismiss={onDismiss}>
      <View style={{ flex: 1, direction: appDirection, justifyContent: 'flex-end', backgroundColor: colors.scrim }} {...fence}>
        {/* The shade beside the card, not around it: wrapped round the card, it was one element to VoiceOver, which found only "Close". */}
        <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={() => onClose()} style={StyleSheet.absoluteFill} />
        <Appear from="below" distance={40} duration={320}>
          <View
            style={{
              margin: space[3],
              marginBottom,
              maxHeight: height - Math.max(insets.top, space[3]) - space[3] - marginBottom,
              ...corner('xxl'),
              backgroundColor: colors.card,
              boxShadow: shadow.raised,
            }}
          >
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingVertical: space[2] }} alwaysBounceVertical={false}>
              {header ? (
                <View style={{ paddingHorizontal: gutter, paddingTop: space[2], paddingBottom: space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  {header}
                </View>
              ) : null}
              <View accessibilityRole="menu">
                {items.map((item, index) => {
                  const Icon = item.icon;
                  const ink = item.destructive ? colors.destructive : colors.foreground;
                  return (
                    <Pressable
                      key={item.label}
                      accessibilityRole="menuitem"
                      accessibilityLabel={item.label}
                      onPress={() => onClose(item.onPress)}
                      style={({ pressed }) => ({
                        minHeight: hitTarget + 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space[3],
                        paddingHorizontal: gutter,
                        borderTopWidth: index ? StyleSheet.hairlineWidth : 0,
                        borderTopColor: colors.border,
                        backgroundColor: pressed ? colors.muted : 'transparent',
                      })}
                    >
                      <Icon size={20} color={item.destructive ? colors.destructive : colors.mutedForeground} />
                      <Text weight="medium" style={{ flex: 1, color: ink }}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </Appear>
      </View>
    </Modal>
  );
}
