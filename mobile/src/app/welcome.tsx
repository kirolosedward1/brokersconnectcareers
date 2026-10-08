import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useLocale, useTranslations } from 'use-intl';
import { LOGO_MARK, Wordmark } from '~/components/brand/brand-logo';
import { Appear } from '~/components/motion/appear';
import { Button, GLASS } from '~/components/ui/button';
import { ForwardChevron, SignInMark } from '~/components/ui/icons';
import { UserRoundPlus } from '~/components/ui/lucide';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { welcomeDrawn } from '~/features/welcome';
import { useTheme } from '~/theme/provider';
import { corner, gutter, motion, space } from '~/theme/tokens';

/** The website's own hero photograph (public/media/hero-poster.jpg; tests/brand.test.ts holds them equal). */
const PHOTO = require('../../assets/images/welcome-photo.jpg');

/**
 * When the screen's parts arrive, after the first frame: the splash screen
 * comes down onto that frame (the root layout), and what moves under it is
 * never seen. Skip first — it opens at every launch with nobody signed in, and
 * someone who has seen it before is not kept waiting for the way past it
 * (iOS takes no taps on what has not begun to show) — with the photograph
 * settling behind it; then the logo, the words and the ways on.
 */
const BEAT = 160;
const AT = {
  skip: 0,
  photo: 0,
  brand: BEAT + 80,
  words: BEAT + 180,
  ways: BEAT + 460,
};

/**
 * The first screen of every launch with nobody signed in, and where signing
 * out leads (src/components/navigation/welcome-gate.tsx): the website's hero
 * photograph across the whole screen under a deep sapphire veil, darkening to
 * midnight where the words are — the logo and what the board is in one line —
 * and the ways on: create an account, sign in, or skip and
 * look around without one, which the App Store asks an app to allow wherever
 * an account is not needed. A company has its own way in, to the employer's
 * sign-up.
 *
 * Dark in either appearance, as the website's hero is, so its words are white
 * and the status bar's light over it.
 *
 * Over the tabs, already drawn underneath — Home, at a launch: skipping fades
 * it away onto them until the app is next started. Signing in closes it with
 * the sign-in sheet (useCloseFlow, which counts it among the flow's screens).
 */
export default function WelcomeScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const window = useWindowDimensions();
  const [shown, setShown] = useState(false);

  // Shown at once under the splash screen (the root layout opens it without
  // animation); closed by fading away onto Home.
  useEffect(() => {
    navigation.setOptions({ animation: 'fade' });
  }, [navigation]);

  // This screen's own Back, whatever has been opened since.
  const skip = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else router.replace('/');
  };

  // A short phone (an SE) keeps the headline in view above the buttons: a
  // smaller headline, smaller buttons, the photograph a little shorter.
  const compact = window.height < 740;
  const photo = Math.round(window.height * (compact ? 0.6 : 0.68));

  return (
    <View
      testID="welcome"
      onLayout={() => {
        welcomeDrawn();
        setShown(true);
      }}
      style={{ flex: 1, backgroundColor: colors.heroDeep }}
    >
      <StatusBar style="light" />
      <Backdrop height={photo} screen={window.height} play={shown} />

      {/* Skip, where iOS keeps a way past: the top, at the end of the line. */}
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: gutter, alignItems: 'flex-end' }}>
        <Appear play={shown} delay={AT.skip} from="none">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('app.welcome.skip')}
            accessibilityHint={t('app.welcome.skipHint')}
            onPress={skip}
            hitSlop={6}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[1],
              minHeight: 38,
              paddingStart: space[4],
              paddingEnd: space[3],
              ...corner('full'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: GLASS.edge,
              backgroundColor: pressed ? GLASS.pressed : GLASS.fill,
            })}
          >
            <Text variant="small" weight="semibold" maxFontSizeMultiplier={1.4} style={{ color: colors.onHero }}>
              {t('app.welcome.skip')}
            </Text>
            <ForwardChevron size={16} color={colors.onHero} />
          </PressableScale>
        </Appear>
      </View>

      {/* The words stand still: when they do not fit (a short phone, a large text size), they are set smaller. */}
      <Words compact={compact} play={shown} locale={locale} />

      {/* The ways on stay at the foot of the screen, whatever the phone's size or text size. */}
      <Appear
        play={shown}
        delay={AT.ways}
        style={{
          gap: space[3],
          paddingHorizontal: gutter,
          paddingTop: space[3],
          paddingBottom: insets.bottom + space[4],
        }}
      >
        <Button
          label={t('nav.signUp')}
          variant="champagne"
          size={compact ? 'default' : 'lg'}
          icon={<UserRoundPlus size={20} color={colors.champagneForeground} />}
          onPress={() => router.push('/sign-up')}
        />
        <Button
          label={t('nav.signIn')}
          variant="glass"
          size={compact ? 'default' : 'lg'}
          icon={<SignInMark size={20} color={colors.onHero} />}
          onPress={() => router.push('/sign-in')}
        />
        <Text variant="small" style={{ color: colors.onHeroMuted, textAlign: 'center', paddingTop: space[1] }}>
          {`${t('app.welcome.employer')} `}
          <Text
            variant="small"
            weight="semibold"
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/sign-up', params: { role: 'employer' } })}
            suppressHighlighting
            style={{ color: colors.champagne }}
          >
            {t('app.auth.forCompanies')}
          </Text>
        </Text>
      </Appear>
    </View>
  );
}

/**
 * Steps the words take down when they do not fit, from the largest: the
 * headline and the line under it, and how far the phone's text size may
 * enlarge them. The last step always fits on a phone.
 */
const STEPS = [
  { title: 'display', lead: 'body', grow: undefined },
  { title: 'title', lead: 'small', grow: undefined },
  { title: 'headline', lead: 'caption', grow: 1.3 },
  { title: 'headline', lead: 'caption', grow: 1 },
] as const;

/**
 * The logo, what the board is and the line under it, at the foot of the
 * space above the buttons. Never scrolled: measured as drawn, and set a step
 * smaller each time they are taller than the space they have.
 */
function Words({ compact, play, locale }: { compact: boolean; play: boolean; locale: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const [step, setStep] = useState(compact ? 1 : 0);
  const [room, setRoom] = useState(0);
  const [needed, setNeeded] = useState(0);
  const last = STEPS.length - 1;

  // One step at a time, each judged on the words as that step draws them.
  const judge = (height: number, words: number) => {
    if (height > 0 && words > height + 1 && step < last) {
      setNeeded(0);
      setStep(step + 1);
    }
  };

  const { title, lead, grow } = STEPS[step];
  return (
    <View
      testID="welcome-words"
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;
        setRoom(height);
        judge(height, needed);
      }}
      style={{ flex: 1, justifyContent: 'flex-end', overflow: 'hidden', paddingHorizontal: gutter, paddingTop: space[4], paddingBottom: space[2] }}
    >
      <View
        testID="welcome-words-content"
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          setNeeded(height);
          judge(room, height);
        }}
        style={{ gap: compact || step > 0 ? space[3] : space[4] }}
      >
        <Appear play={play} delay={AT.brand}>
          <Brand compact={compact || step > 1} locale={locale} />
        </Appear>

        <View style={{ gap: space[2] }}>
          <Appear play={play} delay={AT.words}>
            <Text variant={title} weight="bold" accessibilityRole="header" maxFontSizeMultiplier={grow} style={{ color: colors.onHero }}>
              {t('landingPage.hero.title')}
            </Text>
          </Appear>
          <Appear play={play} delay={AT.words + motion.stagger}>
            <Text variant={lead} maxFontSizeMultiplier={grow} style={{ color: colors.onHeroMuted }}>
              {t('app.welcome.lead')}
            </Text>
          </Appear>
        </View>
      </View>
    </View>
  );
}

/**
 * The photograph across the top of the screen, settling into place as it
 * fades in, under a veil: a little darker under the status bar, sapphire
 * through the middle, and midnight at its foot, where it meets the screen's
 * own colour and the words begin. Drawn for the eye alone.
 */
function Backdrop({ height, screen, play }: { height: number; screen: number; play: boolean }) {
  const { colors } = useTheme();
  // Where the photograph ends, as a share of the screen: the veil is wholly midnight by then.
  const end = Math.min(1, height / screen);

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <Appear play={play} delay={AT.photo} from="none" scale={1.06} duration={1400} style={{ height, overflow: 'hidden' }}>
        <Image source={PHOTO} contentFit="cover" contentPosition="center" style={{ flex: 1 }} accessible={false} />
      </Appear>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.heroDeep} stopOpacity={0.6} />
            <Stop offset={0.16 * end} stopColor={colors.hero} stopOpacity={0.22} />
            <Stop offset={0.45 * end} stopColor={colors.hero} stopOpacity={0.4} />
            <Stop offset={0.8 * end} stopColor={colors.heroDeep} stopOpacity={0.9} />
            <Stop offset={end} stopColor={colors.heroDeep} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.heroDeep} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#veil)" />
      </Svg>
    </View>
  );
}

/**
 * The website's logo, white over the photograph: the mark on its own white
 * tile, and the wordmark in the logo's lettering (the name in the site's font
 * in English). One image to VoiceOver, read as the site's name.
 */
function Brand({ compact, locale }: { compact: boolean; locale: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const tile = compact ? 44 : 52;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('meta.siteName')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}
    >
      <View
        style={{
          width: tile,
          height: tile,
          ...corner('lg'),
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0px 10px 28px rgba(5, 10, 25, 0.4)',
        }}
      >
        <Image source={LOGO_MARK} contentFit="contain" style={{ width: tile * 0.68, height: tile * 0.68 }} accessible={false} />
      </View>
      {locale === 'ar' ? (
        <Wordmark height={compact ? 22 : 26} tint={colors.onHero} />
      ) : (
        <Text variant="headline" weight="bold" style={{ color: colors.onHero }} accessible={false}>
          {t('meta.siteName')}
        </Text>
      )}
    </View>
  );
}
