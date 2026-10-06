import { useEffect, useState, type ComponentType } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useTranslations } from 'use-intl';
import { AuthSwitch } from '~/components/auth/auth-scroll';
import { LOGO_MARK } from '~/components/brand/brand-logo';
import { Appear } from '~/components/motion/appear';
import { Float } from '~/components/motion/float';
import { Button } from '~/components/ui/button';
import { ForwardChevron } from '~/components/ui/icons';
import { Banknote, Clock, MessageCircle, type LucideProps } from '~/components/ui/lucide';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { welcomeAnswered, welcomeDrawn } from '~/features/welcome';
import { useTheme } from '~/theme/provider';
import { corner, gutter, motion, space } from '~/theme/tokens';

/**
 * When the screen's parts arrive, after the first frame: the splash screen
 * comes down onto that frame (the root layout), and what moves under it is
 * never seen. The emblem first, its facts, the words, then the ways on.
 */
const BEAT = 160;
const AT = {
  emblem: BEAT,
  mark: BEAT + 140,
  facts: BEAT + 300,
  words: BEAT + 260,
  ways: BEAT + 480,
  skip: BEAT + 640,
};

/**
 * The first screen of a first launch, signed out (src/components/navigation/welcome-gate.tsx):
 * the website's mark at the centre of an emblem, the three facts the board is
 * built on drifting around it, what the board is in one line, and the ways
 * on — create an account, sign in, or skip and look around without one,
 * which the App Store asks an app to allow wherever an account is not needed.
 * A company has its own way in, to the employer's sign-up.
 *
 * Over Home, which is already drawn underneath: skipping fades it away onto
 * the board's newest listings. Signing in closes it with the sign-in sheet
 * (useCloseFlow, which counts it among the flow's screens). Either answers it
 * on this phone for good.
 */
export default function WelcomeScreen() {
  const t = useTranslations();
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

  const skip = () => {
    welcomeAnswered();
    router.back();
  };

  // The emblem takes what the phone can spare: a quarter of its height (a
  // fifth on a short phone, an SE), never wider than the page with room for
  // its rings. A short phone also has sign-in as a line under the button
  // rather than a second button: the headline stays in view above them.
  const compact = window.height < 740;
  const emblem = Math.round(Math.min(220, window.height * (compact ? 0.2 : 0.25), (window.width - gutter * 2) / 1.6));

  return (
    <View
      testID="welcome"
      onLayout={() => {
        welcomeDrawn();
        setShown(true);
      }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
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
              backgroundColor: pressed ? colors.muted : colors.secondary,
            })}
          >
            <Text variant="small" weight="semibold" tone="secondaryForeground" maxFontSizeMultiplier={1.4}>
              {t('app.welcome.skip')}
            </Text>
            <ForwardChevron size={16} color={colors.secondaryForeground} />
          </PressableScale>
        </Appear>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          gap: compact ? space[4] : space[8],
          paddingHorizontal: gutter,
          paddingVertical: compact ? space[2] : space[5],
        }}
      >
        <Emblem size={emblem} play={shown} />

        <View style={{ gap: space[2] }}>
          <Appear play={shown} delay={AT.words}>
            <Text variant="small" weight="semibold" tone="goldForeground" style={styles.centred}>
              {t('meta.siteName')}
            </Text>
          </Appear>
          <Appear play={shown} delay={AT.words + motion.stagger}>
            <Text variant="display" weight="bold" accessibilityRole="header" style={styles.centred}>
              {t('landingPage.hero.title')}
            </Text>
          </Appear>
          <Appear play={shown} delay={AT.words + motion.stagger * 2}>
            <Text tone="mutedForeground" style={styles.centred}>
              {t('app.welcome.lead')}
            </Text>
          </Appear>
        </View>
      </ScrollView>

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
        <Button label={t('nav.signUp')} size="lg" onPress={() => router.push('/sign-up')} />
        {compact ? (
          <AuthSwitch question={t('auth.hasAccount')} action={t('nav.signIn')} onPress={() => router.push('/sign-in')} />
        ) : (
          <Button label={t('nav.signIn')} variant="outline" size="lg" onPress={() => router.push('/sign-in')} />
        )}
        <Text variant="small" tone="mutedForeground" style={[styles.centred, { paddingTop: space[1] }]}>
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
      </Appear>
    </View>
  );
}

/**
 * The website's mark on a white tile, at the centre of a sapphire disc whose
 * champagne rings open outward as a plan's sightlines do — the Home panel's
 * drawing — with the board's three promises drifting at its edge. One image
 * to VoiceOver, read as the site's name; the promises are said in the words
 * below it.
 */
function Emblem({ size, play }: { size: number; play: boolean }) {
  const t = useTranslations();
  const { colors, shadow } = useTheme();
  const box = Math.round(size * 1.6);
  const tile = Math.round(size * 0.46);
  const mark = Math.round(tile * 0.68);
  const rings = [0.58, 0.68, 0.79].map((share) => Math.round(size * share));

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('meta.siteName')}
      style={{ alignSelf: 'stretch', height: box, alignItems: 'center', justifyContent: 'center' }}
    >
      <Appear play={play} delay={AT.emblem} from="none" scale={0.94} duration={900} style={{ position: 'absolute' }}>
        <Svg width={box} height={box}>
          {rings.map((r, index) => (
            <Circle
              key={r}
              cx={box / 2}
              cy={box / 2}
              r={r}
              stroke={colors.gold}
              strokeOpacity={[0.5, 0.3, 0.16][index]}
              strokeWidth={1}
              fill="none"
            />
          ))}
        </Svg>
      </Appear>

      <Appear play={play} delay={AT.emblem} from="none" scale={0.9} duration={700}>
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.hero,
            experimental_backgroundImage: `linear-gradient(160deg, ${colors.hero} 0%, ${colors.heroDeep} 100%)`,
            boxShadow: shadow.hero,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Appear play={play} delay={AT.mark} from="none" scale={0.8}>
            <View
              style={{
                width: tile,
                height: tile,
                ...corner('xxl'),
                backgroundColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0px 12px 32px rgba(5, 10, 25, 0.35)',
              }}
            >
              <Image source={LOGO_MARK} contentFit="contain" style={{ width: mark, height: mark }} accessible={false} />
            </View>
          </Appear>
        </View>
      </Appear>

      <Fact
        play={play}
        icon={Banknote}
        tint={colors.success}
        wash={colors.successMuted}
        label={t('app.welcome.factPay')}
        delay={AT.facts}
        phase={0}
        style={{ top: box * 0.1, start: 0 }}
      />
      <Fact
        play={play}
        icon={Clock}
        tint={colors.goldForeground}
        wash={colors.accent}
        label={t('app.welcome.factApply')}
        delay={AT.facts + motion.stagger}
        phase={1400}
        style={{ top: box * 0.45, end: 0 }}
      />
      <Fact
        play={play}
        icon={MessageCircle}
        tint={colors.success}
        wash={colors.successMuted}
        label={t('app.welcome.factWhatsapp')}
        delay={AT.facts + motion.stagger * 2}
        phase={700}
        style={{ bottom: box * 0.08, start: box * 0.04 }}
      />
    </View>
  );
}

/** One of the board's promises, as a small card drifting at the emblem's edge. */
function Fact({
  icon: Icon,
  tint,
  wash,
  label,
  delay,
  phase,
  play,
  style,
}: {
  icon: ComponentType<LucideProps>;
  tint: string;
  wash: string;
  label: string;
  delay: number;
  phase: number;
  play: boolean;
  style: ViewStyle;
}) {
  const { colors, shadow } = useTheme();
  return (
    <Float play={play} phase={phase + delay} style={[{ position: 'absolute' }, style]}>
      <Appear play={play} delay={delay} distance={10}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            paddingVertical: 6,
            paddingStart: 6,
            paddingEnd: space[3],
            ...corner('full'),
            backgroundColor: colors.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            boxShadow: shadow.raised,
          }}
        >
          <View
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: wash, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon size={15} color={tint} />
          </View>
          <Text variant="caption" weight="semibold" numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {label}
          </Text>
        </View>
      </Appear>
    </Float>
  );
}

const styles = StyleSheet.create({
  centred: { textAlign: 'center' },
});
