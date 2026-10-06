import { View } from 'react-native';
import { Image } from 'expo-image';
import { useLocale, useTranslations } from 'use-intl';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/** The website's mark: the same file as public/brand/logo-mark.png (tests/brand.test.ts holds them equal). */
export const LOGO_MARK = require('../../../assets/brand/logo-mark.png');

/**
 * The website's logo itself, its Arabic lockup (public/brand/logo-ar.png):
 * the wordmark in the logo's own lettering, and the mark. Cut apart at the
 * gap between them, so that in dark mode the wordmark alone takes the page's
 * ink and the mark keeps its two colours; side by side, at the gap, they are
 * the file pixel for pixel (tests/brand.test.ts).
 */
export const LOGO_WORDMARK = require('../../../assets/brand/logo-wordmark-ar.png');
export const LOGO_LOCKUP_MARK = require('../../../assets/brand/logo-lockup-mark.png');

/** The lockup's parts, in its own pixels: their widths, the gap between them, and the height they share. */
export const LOCKUP = { wordmark: 1375, gap: 106, mark: 439, height: 286 } as const;

/** The logo's height. */
const HEIGHTS = {
  /** A navigation bar's title. */
  header: 28,
  /** Above a sign-in form. */
  form: 36,
  /** A page of its own. */
  hero: 46,
} as const;

/**
 * The website's logo: its own artwork, not the name typed out. Read by
 * VoiceOver as the name, once.
 *
 * The artwork's wordmark is Arabic. In English the app writes the name beside
 * the mark in the site's font, as the English website does
 * (src/components/logo.tsx).
 */
export function BrandLogo({ size = 'header' }: { size?: keyof typeof HEIGHTS }) {
  const t = useTranslations();
  const locale = useLocale();
  const name = t('meta.siteName');
  const height = HEIGHTS[size];

  if (locale !== 'ar') {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={name}
        testID="brand-logo"
        style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}
      >
        <Image source={LOGO_MARK} contentFit="contain" style={{ width: height, height }} accessible={false} />
        <Text variant={size === 'hero' ? 'title' : 'headline'} weight="bold" numberOfLines={1} maxFontSizeMultiplier={1.4} accessible={false}>
          {name}
        </Text>
      </View>
    );
  }

  const scale = height / LOCKUP.height;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      testID="brand-logo"
      // The artwork's own order whichever way the page reads: the wordmark at the left, the mark at the right.
      style={{ direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: LOCKUP.gap * scale }}
    >
      <Wordmark height={height} />
      <Image
        source={LOGO_LOCKUP_MARK}
        contentFit="contain"
        style={{ width: LOCKUP.mark * scale, height }}
        accessible={false}
      />
    </View>
  );
}

/**
 * The logo's wordmark alone, for a page that shows the mark already: in the
 * logo's blue, or in the page's ink in dark mode. Not read by VoiceOver: the
 * page around it says the name.
 */
export function Wordmark({ height }: { height: number }) {
  const { colors, scheme } = useTheme();
  return (
    <Image
      source={LOGO_WORDMARK}
      contentFit="contain"
      tintColor={scheme === 'dark' ? colors.foreground : undefined}
      style={{ width: (LOCKUP.wordmark * height) / LOCKUP.height, height }}
      accessible={false}
    />
  );
}
