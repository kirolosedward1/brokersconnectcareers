import { createContext, useContext, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackHeaderProps } from 'expo-router/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { BackChevron } from '~/components/ui/icons';
import { Text } from '~/components/ui/text';
import { InSheet } from '~/components/ui/states';
import { useTheme } from '~/theme/provider';
import { corner, font, gutter, hitTarget, space } from '~/theme/tokens';

/** Inside the page's own bar, where a screen's bar items are drawn. */
const InBar = createContext(false);

/**
 * A bar item (`headerRight`, `headerLeft`) drawn only in the page's own bar.
 * Native-stack also mounts a screen's items in iOS's bar, hidden under this
 * one: there they would be a second bell asking for the unread count, a
 * second Share for VoiceOver to find.
 */
export function BarOnly({ children }: { children: ReactNode }) {
  return useContext(InBar) ? children : null;
}

/** The bar's own height under the status bar, as iOS's. */
export const BAR_HEIGHT = 52;

/**
 * Every stack's bar, drawn as part of the page it heads (native-stack renders
 * a `header` inside the screen's own view): a page opened slides in whole,
 * its bar with it, and Back slides it away the same. iOS's own bar is a view
 * of the navigation controller's, outside the page — under the app's right to
 * left it slid one way while the page slid the other, and with the app's own
 * push it changed at once while the page was still sliding in.
 *
 * Back at the start of the line (the right, in Arabic), the title centred, the
 * screen's own items (`headerRight`: the bell, Share) at the end, each in a
 * round tile as iOS 26 draws its bar's buttons. Back goes through the
 * navigator, so a form with unsaved changes still asks first.
 */
export function PageHeader({ back, options, navigation }: NativeStackHeaderProps) {
  const t = useTranslations('common');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // A sheet's own top is below the status bar (src/app/_layout.tsx, rootScreenLayout).
  const inSheet = useContext(InSheet);
  const top = inSheet && Platform.OS === 'ios' ? 0 : insets.top;

  const title = typeof options.headerTitle === 'string' ? options.headerTitle : options.title;
  const custom = options.headerLeft?.({ canGoBack: Boolean(back), tintColor: colors.primary });
  const leading = custom
    ? <Tile>{custom}</Tile>
    : back && options.headerBackVisible !== false
      ? (
          <Tile>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('back')}
              onPress={() => navigation.goBack()}
              hitSlop={8}
              testID="header-back"
              style={({ pressed }) => ({
                width: hitTarget,
                height: hitTarget,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.55 : 1,
              })}
            >
              <BackChevron size={24} color={colors.foreground} />
            </Pressable>
          </Tile>
        )
      : null;
  const trailing = options.headerRight?.({ canGoBack: Boolean(back), tintColor: colors.primary });

  return (
    <InBar.Provider value>
      <View
        testID="page-header"
        style={{
          paddingTop: top,
          backgroundColor: colors.background,
        }}
      >
        <View
          style={{
            height: BAR_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: gutter - space[1],
          }}
        >
          {title ? (
            // Centred on the bar whatever the items' widths, clear of both; read between Back and the items.
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: hitTarget * 2 }]}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
                style={{ fontFamily: font.semibold, fontSize: 17, lineHeight: 24, color: colors.foreground, textAlign: 'center' }}
              >
                {title}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: hitTarget }}>{leading}</View>
          <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: hitTarget, justifyContent: 'flex-end' }}>
            {trailing ? <Tile>{trailing}</Tile> : null}
          </View>
        </View>
      </View>
    </InBar.Provider>
  );
}

/** A bar button's round tile: the card's colour, a hairline edge and a soft lift, as iOS 26's glass reads on paper. */
function Tile({ children }: { children: ReactNode }) {
  const { colors, lift } = useTheme();
  return (
    <View
      style={{
        minWidth: hitTarget,
        minHeight: hitTarget,
        ...corner('full'),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: colors.card,
        ...lift,
      }}
    >
      {children}
    </View>
  );
}
