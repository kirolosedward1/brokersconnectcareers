import { useEffect, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { BrandLogo } from '~/components/brand/brand-logo';
import { Hero } from '~/components/home/hero';
import { Button } from '~/components/ui/button';
import { Banknote, Clock, MessageCircle } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { welcomeAnswered, welcomeDrawn } from '~/features/welcome';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * The first screen of a first launch, signed out (src/components/navigation/welcome-gate.tsx):
 * the website's logo, what the board is, and the three ways on — create an
 * account, sign in, or look around without one, which the App Store asks an
 * app to allow wherever an account is not needed. A company has its own way
 * in, to the employer's sign-up.
 *
 * Over Home, which is already drawn underneath: looking around closes it onto
 * the board's newest listings. Signing in closes it with the sign-in sheet
 * (useCloseFlow, which counts it among the flow's screens). Either answers it
 * on this phone for good.
 */
export default function WelcomeScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  // Shown at once under the splash screen (the root layout opens it without
  // animation); closed the usual way, sliding down onto Home.
  useEffect(() => {
    navigation.setOptions({ animation: 'default' });
  }, [navigation]);

  const browse = () => {
    welcomeAnswered();
    router.back();
  };

  const points: { icon: ReactNode; text: string }[] = [
    { icon: <Banknote size={18} color={colors.champagne} />, text: t('landingPage.features.payTitle') },
    { icon: <Clock size={18} color={colors.champagne} />, text: t('landingPage.features.applyTitle') },
    { icon: <MessageCircle size={18} color={colors.champagne} />, text: t('landingPage.features.whatsappTitle') },
  ];

  return (
    <ScrollView
      testID="welcome"
      style={{ backgroundColor: colors.background }}
      onLayout={welcomeDrawn}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'space-between',
        gap: space[8],
        paddingHorizontal: gutter,
        paddingTop: insets.top + space[6],
        paddingBottom: insets.bottom + space[5],
      }}
    >
      <View style={{ gap: space[8] }}>
        <View style={{ alignItems: 'center' }}>
          <BrandLogo size="hero" stacked />
        </View>

        <Hero eyebrow={t('landingPage.hero.eyebrow')} title={t('landingPage.hero.title')}>
          {points.map(({ icon, text }) => (
            <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              {icon}
              <Text weight="medium" style={{ color: colors.onHero, flexShrink: 1 }}>
                {text}
              </Text>
            </View>
          ))}
        </Hero>
      </View>

      <View style={{ gap: space[3] }}>
        <Button label={t('nav.signUp')} size="lg" onPress={() => router.push('/sign-up')} />
        <Button label={t('nav.signIn')} variant="outline" size="lg" onPress={() => router.push('/sign-in')} />
        <Button label={t('app.welcome.browse')} variant="ghost" size="lg" onPress={browse} />
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center', marginTop: space[1] }}>
          {`${t('app.welcome.employer')} `}
          <Text
            variant="small"
            weight="semibold"
            tone="primary"
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/sign-up', params: { role: 'employer' } })}
            suppressHighlighting
          >
            {t('app.auth.forCompanies')}
          </Text>
        </Text>
      </View>
    </ScrollView>
  );
}
