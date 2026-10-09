import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { BadgeCheck, FileCheck, Flag } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * A company's verified mark that says what it means when tapped: a sheet
 * with the website's own facts — the commercial register and the tax card,
 * looked at by the team — and what it does not promise. `children` is the
 * mark as the place draws it (a bare tick, or a "verified" badge); without
 * them, the bare gold tick.
 */
export function VerifiedMark({ size = 16, children }: { size?: number; children?: ReactNode }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const sheet = useSheet();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('companies.verified')}
        accessibilityHint={t('app.verified.hint')}
        hitSlop={10}
        onPress={sheet.show}
        testID="verified-mark"
      >
        {children ?? <BadgeCheck size={size} color={colors.gold} />}
      </Pressable>
      {/* Drawn only while open (and closing): a mark on every card of a list must not carry a sheet each. */}
      {sheet.mounted ? <VerifiedSheet visible={sheet.open} onClose={sheet.hide} onDismiss={sheet.onDismiss} /> : null}
    </>
  );
}

export function VerifiedSheet({ visible, onClose, onDismiss }: { visible: boolean; onClose: () => void; onDismiss?: () => void }) {
  const t = useTranslations('app.verified');
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        onPress={onClose}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5, 10, 25, 0.45)' }}
      >
        {/* The card itself takes its own taps: only the shade around it closes it. */}
        <Pressable
          accessible={false}
          onPress={() => {}}
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
        </Pressable>
      </Pressable>
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
