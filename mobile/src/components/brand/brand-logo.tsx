import { View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslations } from 'use-intl';
import { Text } from '~/components/ui/text';
import { space } from '~/theme/tokens';

/** The website's mark: the same file as public/brand/logo-mark.png (tests/brand.test.ts holds them equal). */
export const LOGO_MARK = require('../../../assets/brand/logo-mark.png');

const SIZES = {
  /** A navigation bar's title. */
  header: { mark: 30, variant: 'headline', grow: 1.2 },
  /** Above a sign-in form. */
  form: { mark: 36, variant: 'headline', grow: 1.6 },
  /** The welcome screen. */
  hero: { mark: 72, variant: 'title', grow: 1.6 },
} as const;

/**
 * The website's logo (src/components/logo.tsx): the mark, and the site's name
 * beside it in the site's font and weight — the name at every size, as on the
 * website, where a mark alone was two blue squares and no name. Read by
 * VoiceOver as the name, once.
 */
export function BrandLogo({ size = 'header', stacked = false }: { size?: keyof typeof SIZES; stacked?: boolean }) {
  const t = useTranslations();
  const { mark, variant, grow } = SIZES[size];
  const name = t('meta.siteName');

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      testID="brand-logo"
      style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? space[3] : space[2] }}
    >
      <Image source={LOGO_MARK} contentFit="contain" style={{ width: mark, height: mark }} accessible={false} />
      <Text variant={variant} weight="bold" numberOfLines={1} maxFontSizeMultiplier={grow} accessible={false}>
        {name}
      </Text>
    </View>
  );
}
