import { Linking, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { WhatsAppIcon } from '~/components/ui/icons';
import { Phone } from '~/components/ui/lucide';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

export type ContactMethod = 'whatsapp' | 'call';

/** The digits and the plus a dialler takes, from a number as it is written. */
export function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/**
 * How a person is reached in this market, drawn one way everywhere (rule 8):
 * WhatsApp first, as a capsule in WhatsApp's own green that takes the width,
 * and a call beside it as a round button of at least 44pt. Each is named for
 * the person it reaches. `onPress` hears which one was pressed (the reveal →
 * WhatsApp funnel); the link opens either way.
 */
export function ContactButtons({
  name,
  whatsappUrl,
  phone,
  size = 'lg',
  onPress,
}: {
  name: string;
  whatsappUrl: string;
  /** No call button without a number. */
  phone?: string | null;
  /** 52pt on a page, 44pt on a card in a list. */
  size?: 'lg' | 'sm';
  onPress?: (method: ContactMethod) => void;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const height = size === 'lg' ? 52 : hitTarget;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('app.contact.whatsappTo', { name })}
        onPress={() => {
          onPress?.('whatsapp');
          Linking.openURL(whatsappUrl).catch(() => {});
        }}
        style={{
          flex: 1,
          minHeight: height,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[2],
          paddingHorizontal: space[4],
          ...corner('full'),
          backgroundColor: colors.whatsapp,
        }}
      >
        <WhatsAppIcon size={size === 'lg' ? 20 : 18} color={colors.whatsappForeground} />
        <Text weight="semibold" variant={size === 'lg' ? 'body' : 'small'} style={{ color: colors.whatsappForeground }}>
          {t('app.directory.whatsapp')}
        </Text>
      </PressableScale>
      {phone ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('app.contact.callTo', { name })}
          onPress={() => {
            onPress?.('call');
            Linking.openURL(`tel:${dialable(phone)}`).catch(() => {});
          }}
          style={{
            width: height,
            height,
            alignItems: 'center',
            justifyContent: 'center',
            ...corner('full'),
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Phone size={20} color={colors.primary} />
        </PressableScale>
      ) : null}
    </View>
  );
}
