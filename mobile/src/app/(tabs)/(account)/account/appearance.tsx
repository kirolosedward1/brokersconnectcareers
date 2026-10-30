import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { NUM_STYLE, numText } from '~/components/ui/num';
import { PressableScale } from '~/components/ui/pressable-scale';
import { ChoiceRow, SettingsGroup, SettingsRow, SwitchRow } from '~/components/ui/settings-list';
import { Text } from '~/components/ui/text';
import { setAppPreference, toNumerals, useAppPreferences, type Numerals } from '~/features/preferences/app-preferences';
import { useMoney } from '~/features/money';
import { isolate } from '~/i18n/rich';
import { haptic } from '~/lib/haptics';
import { usePhoneReduceMotion } from '~/theme/reduce-motion';
import { useTheme, type ThemePreference } from '~/theme/provider';
import { corner, gutter, hitTarget, palette, space, type Colors } from '~/theme/tokens';

/** The sample figure the numerals choice draws itself with. */
const SAMPLE = 12000;

/**
 * How this phone draws the app (the Appearance board): light, dark or as the
 * phone is; the digits numbers are written in; text size, which is the
 * phone's own (the app follows Dynamic Type everywhere, and a second slider
 * here would fight it), with a sample at the size it is now; and motion and
 * touch. Kept on this phone (app-preferences.ts, ThemeProvider).
 *
 * The language and the app icon on the board wait: English is not published
 * yet (ENGLISH_ENABLED), and another icon needs a native build.
 */
export default function AppearanceScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const money = useMoney();
  const { colors, preference, setPreference } = useTheme();
  const preferences = useAppPreferences();
  const phoneReduces = usePhoneReduceMotion();

  const themes: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('theme.light') },
    { value: 'dark', label: t('theme.dark') },
    { value: 'system', label: t('theme.system') },
  ];
  const sample = (numerals: Numerals) => isolate(toNumerals(numText(SAMPLE, locale), numerals, locale));

  return (
    <>
      <Stack.Screen options={{ title: t('app.appearance.title') }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: space[12],
          gap: space[6],
        }}
      >
        <View style={{ gap: space[2] }}>
          <Text variant="label" weight="semibold" tone="mutedForeground" accessibilityRole="header" style={{ paddingHorizontal: space[1] }}>
            {t('app.appearance.theme')}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('app.appearance.theme')}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}
          >
            {themes.map((theme) => (
              <ThemeTile
                key={theme.value}
                value={theme.value}
                label={theme.label}
                selected={preference === theme.value}
                onPress={() => {
                  if (preference !== theme.value) haptic.selection();
                  setPreference(theme.value);
                }}
              />
            ))}
          </View>
        </View>

        <SettingsGroup title={t('app.appearance.numerals')} footer={t('app.appearance.numeralsHint')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('app.appearance.numerals')}>
            {(['latn', 'arab'] as const).map((numerals) => (
              <ChoiceRow
                key={numerals}
                label={t(numerals === 'latn' ? 'app.appearance.numeralsLatn' : 'app.appearance.numeralsArab')}
                selected={preferences.numerals === numerals}
                onPress={() => {
                  if (preferences.numerals !== numerals) haptic.selection();
                  setAppPreference('numerals', numerals);
                }}
                trailing={
                  <Text variant="small" tone="mutedForeground">
                    <Text variant="small" tone="mutedForeground" style={NUM_STYLE}>
                      {sample(numerals)}
                    </Text>{' '}
                    {money.unit}
                  </Text>
                }
              />
            ))}
          </View>
        </SettingsGroup>

        <SettingsGroup title={t('app.appearance.textSize')}>
          <SettingsRow
            label={t('app.appearance.textSizeFollow')}
            hint={t('app.appearance.textSizeWhere')}
            value={t('app.appearance.textSizeOpen')}
            onPress={() => Linking.openSettings().catch(() => {})}
          />
          {/* At the size the phone draws now, as a listing's title and pay are drawn. */}
          <View
            accessible
            accessibilityLabel={t('app.appearance.textSizePreview')}
            style={{
              gap: space[1],
              padding: space[4],
              borderTopWidth: StyleSheet.hairlineWidth * 2,
              borderTopColor: colors.border,
            }}
          >
            <Text variant="caption" tone="mutedForeground">
              {t('app.appearance.textSizePreview')}
            </Text>
            <Text weight="semibold">{t('app.appearance.sampleTitle')}</Text>
            <Text variant="small" tone="primary" weight="semibold">
              {money.amount(SAMPLE)} {money.perMonth}
            </Text>
          </View>
        </SettingsGroup>

        <SettingsGroup title={t('app.appearance.motion')}>
          <SwitchRow
            testID="reduce-motion"
            label={t('app.appearance.reduceMotion')}
            hint={phoneReduces ? t('app.appearance.reduceMotionPhone') : t('app.appearance.reduceMotionHint')}
            value={phoneReduces || preferences.reduceMotion}
            disabled={phoneReduces}
            onChange={(value) => setAppPreference('reduceMotion', value)}
          />
          <SwitchRow
            testID="haptics"
            label={t('app.appearance.haptics')}
            hint={t('app.appearance.hapticsHint')}
            value={preferences.haptics}
            onChange={(value) => {
              setAppPreference('haptics', value);
              if (value) haptic.tap();
            }}
          />
        </SettingsGroup>
      </ScrollView>
    </>
  );
}

/** One of the three appearances, drawn as a small screen in its own colours, with its name under it. */
function ThemeTile({ value, label, selected, onPress }: { value: ThemePreference; label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const light = palette.light;
  const dark = palette.dark;
  const half = (scheme: Colors) => (
    <View
      style={{
        flex: 1,
        backgroundColor: scheme.background,
        padding: space[2],
        gap: space[1],
      }}
    >
      <View
        style={{
          height: 8,
          width: '60%',
          ...corner('full'),
          backgroundColor: scheme.primary,
        }}
      />
      <View
        style={{
          height: 22,
          ...corner('md'),
          backgroundColor: scheme.card,
          borderWidth: 1,
          borderColor: scheme.border,
        }}
      />
      <View
        style={{
          height: 22,
          ...corner('md'),
          backgroundColor: scheme.card,
          borderWidth: 1,
          borderColor: scheme.border,
        }}
      />
    </View>
  );
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: 96,
        gap: space[2],
        alignItems: 'center',
        minHeight: hitTarget,
      }}
    >
      <View
        style={{
          alignSelf: 'stretch',
          height: 96,
          flexDirection: 'row',
          overflow: 'hidden',
          ...corner('lg'),
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth * 2,
          borderColor: selected ? colors.primary : colors.border,
        }}
      >
        {value === 'system' ? (
          <>
            {half(light)}
            {half(dark)}
          </>
        ) : (
          half(value === 'dark' ? dark : light)
        )}
      </View>
      <Text variant="small" weight={selected ? 'semibold' : 'regular'} tone={selected ? 'primary' : 'foreground'}>
        {label}
      </Text>
    </PressableScale>
  );
}
