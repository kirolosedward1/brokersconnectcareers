import { useEffect, useRef, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { BadgeCheck, FileCheck, Flag } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { useSheetFence } from '~/components/ui/sheet-fence';
import { appDirection } from '~/lib/direction';

/** The host's way of opening the sheet (VerifiedExplainerHost), while one is drawn. */
const hosts = new Set<() => void>();

/**
 * A company's verified mark that says what it means when tapped: a sheet
 * with the website's own facts — the commercial register and the tax card,
 * looked at by the team — and what it does not promise. `children` is the
 * mark as the place draws it (a bare tick, or a "verified" badge); without
 * them, the bare gold tick.
 *
 * The sheet is drawn once, at the app's root (VerifiedExplainerHost), not
 * beside the mark: the mark sits inside cards that are links and that swipe,
 * and a touch in a sheet drawn there went on to the card around it — a
 * sideways drag on the sheet swiped the board's card away behind it. Drawn
 * inside a list's row, it also went when the row was drawn again.
 */
export function VerifiedMark({ size = 16, children }: { size?: number; children?: ReactNode }) {
  const t = useTranslations();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('companies.verified')}
      accessibilityHint={t('app.verified.hint')}
      // A 44-point target round however small the mark is drawn.
      hitSlop={Math.max(10, (hitTarget - size) / 2)}
      onPress={() => {
        for (const show of hosts) show();
      }}
      testID="verified-mark"
    >
      {children ?? <BadgeCheck size={size} color={colors.gold} />}
    </Pressable>
  );
}

/** Where the marks' sheet is drawn: once, beside the app's navigators, outside every card. */
export function VerifiedExplainerHost() {
  const sheet = useSheet();
  const show = useRef(sheet.show);
  useEffect(() => {
    show.current = sheet.show;
  });
  useEffect(() => {
    const open = () => show.current();
    hosts.add(open);
    return () => {
      hosts.delete(open);
    };
  }, []);
  return sheet.mounted ? <VerifiedSheet visible={sheet.open} onClose={sheet.hide} onDismiss={sheet.onDismiss} /> : null;
}

export function VerifiedSheet({ visible, onClose, onDismiss }: { visible: boolean; onClose: () => void; onDismiss?: () => void }) {
  const t = useTranslations('app.verified');
  // The sheet keeps its touches from the row or card it is drawn in (sheet-fence.ts).
  const fence = useSheetFence();
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={{ flex: 1, direction: appDirection, justifyContent: 'flex-end', backgroundColor: 'rgba(5, 10, 25, 0.45)' }} {...fence}>
        {/* The shade beside the card, not around it: wrapped round the card, it was one element to VoiceOver. */}
        <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          style={{
            margin: space[3],
            marginBottom: Math.max(insets.bottom, space[3]),
            padding: gutter,
            gap: space[4],
            ...corner('xxl'),
            backgroundColor: colors.card,
            boxShadow: shadow.raised,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }}>
              <BadgeCheck size={24} color={colors.gold} />
            </View>
            <Text variant="headline" weight="bold" accessibilityRole="header" style={{ flex: 1 }}>
              {t('title')}
            </Text>
          </View>
          <Point icon={<FileCheck size={18} color={colors.primary} />} text={t('papers')} />
          <Point icon={<BadgeCheck size={18} color={colors.primary} />} text={t('reviewed')} />
          <Point icon={<Flag size={18} color={colors.primary} />} text={t('notAPromise')} />
          <Button label={t('close')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Point({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <Text style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}
