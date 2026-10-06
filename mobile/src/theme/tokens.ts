import { Platform, type ViewStyle } from 'react-native';

/**
 * The app's design tokens.
 *
 * The brand is the website's — its mark, its font, its royal blue — set in a
 * quieter, more considered key for the phone. Light is ivory paper with deep
 * sapphire ink: the brand blue taken down to the navy the industry's grandest
 * names print in. Dark is near-black with champagne, where navy would vanish.
 * Champagne gold is the one precious accent in both, kept for what has been
 * earned or checked — a verified company — never for decoration.
 *
 * Every text colour holds 4.5:1 on every surface it is drawn on, in both
 * schemes; icons that carry meaning and the borders of fields hold 3:1.
 * Light is the default whatever the phone's setting, as on the website.
 */
export const palette = {
  light: {
    background: '#F6F4F0',
    foreground: '#121620',
    card: '#FFFFFF',
    primary: '#16295A',
    primaryPressed: '#0E1D44',
    primaryForeground: '#FFFFFF',
    secondary: '#ECEEF4',
    secondaryForeground: '#16295A',
    muted: '#F0EDE7',
    mutedForeground: '#5C6270',
    accent: '#F4EAD7',
    accentForeground: '#6B4E1A',
    /** Champagne: the verified seal and the hairline accents (3:1 as a mark). */
    gold: '#A27A3B',
    /** Champagne as text (4.5:1). */
    goldForeground: '#7A5A1F',
    success: '#1B7A4B',
    successForeground: '#FFFFFF',
    successMuted: '#E2F2E7',
    warning: '#8F5B0E',
    warningMuted: '#FAEED6',
    destructive: '#B5372C',
    destructiveForeground: '#FFFFFF',
    destructiveMuted: '#FAE8E4',
    border: '#E6E1D8',
    input: '#8B8578',
    brandCyan: '#5CE1E6',
    /** A surface lifted off a card: the chosen segment of a segmented control. */
    raised: '#FFFFFF',
    /** Champagne as a fill (a button on the hero), with its ink. */
    champagne: '#D8BC86',
    champagnePressed: '#E6CC99',
    champagneForeground: '#17120A',
    /** The hero panel: deep sapphire falling to midnight, and the words on it. */
    hero: '#16295A',
    heroDeep: '#0B1734',
    onHero: '#FFFFFF',
    onHeroMuted: '#C9D0DE',
  },
  dark: {
    background: '#0A0C10',
    foreground: '#F3F0EA',
    card: '#14171D',
    primary: '#D8BC86',
    primaryPressed: '#E6CC99',
    primaryForeground: '#17120A',
    secondary: '#1F232B',
    secondaryForeground: '#ECE7DD',
    muted: '#1A1D24',
    mutedForeground: '#A3A7B0',
    accent: '#2E2617',
    accentForeground: '#E6CB93',
    gold: '#D4B47A',
    goldForeground: '#E2C792',
    success: '#55B582',
    successForeground: '#06120B',
    successMuted: '#11281B',
    warning: '#E2B05A',
    warningMuted: '#33270E',
    destructive: '#F27468',
    destructiveForeground: '#1A0806',
    destructiveMuted: '#3A1714',
    border: '#272B33',
    input: '#6F7480',
    brandCyan: '#5CE1E6',
    raised: '#353B47',
    champagne: '#D8BC86',
    champagnePressed: '#E6CC99',
    champagneForeground: '#17120A',
    hero: '#152241',
    heroDeep: '#0A1124',
    onHero: '#F3F0EA',
    onHeroMuted: '#B9C0CF',
  },
} as const;

export type Scheme = keyof typeof palette;
export type Colors = { [K in keyof (typeof palette)['light']]: string };

/**
 * Depth, per scheme. In light, a hairline and two soft shadows tinted with the
 * ink, so a card sits on the paper rather than being outlined on it. In dark,
 * shadows do not show: a lifted surface is a lighter one, with a faint light
 * edge along its top.
 */
export const shadows = {
  light: {
    card: '0px 1px 2px rgba(18, 22, 32, 0.04), 0px 6px 20px rgba(18, 22, 32, 0.06)',
    raised: '0px 2px 6px rgba(18, 22, 32, 0.06), 0px 16px 40px rgba(18, 22, 32, 0.10)',
    hero: '0px 18px 48px rgba(14, 29, 68, 0.28)',
  },
  dark: {
    card: 'inset 0px 1px 0px rgba(255, 255, 255, 0.04)',
    raised: 'inset 0px 1px 0px rgba(255, 255, 255, 0.06), 0px 16px 40px rgba(0, 0, 0, 0.45)',
    hero: 'inset 0px 1px 0px rgba(255, 255, 255, 0.07), 0px 18px 48px rgba(0, 0, 0, 0.5)',
  },
} as const;

export type Shadows = { [K in keyof (typeof shadows)['light']]: string };

/**
 * The card's shadow for what repeats down a list — cards, and the buttons on
 * them — drawn as iOS draws a shadow cheaply: one shadow on the view's own
 * layer, whose path React Native computes from its opaque fill and corners.
 * `boxShadow` adds a layer per shadow with a mask instead, rendered
 * off-screen and rebuilt on every layout and press: fine once on a screen,
 * too much on every row of a list. Only on a view with an opaque background.
 * Other platforms keep `boxShadow`. In dark there is none: the faint inset
 * line it stands for is not visible on a row.
 */
export const lifts: { [S in keyof typeof shadows]: ViewStyle } = {
  light:
    Platform.OS === 'ios'
      ? { shadowColor: '#121620', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } }
      : { boxShadow: shadows.light.card },
  dark: Platform.OS === 'ios' ? {} : { boxShadow: shadows.dark.card },
};

/**
 * Corners, drawn as Apple draws its own (`continuous`, a squircle rather than a
 * quarter circle): cards at 20, fields at 14, small marks at 10, and anything a
 * finger presses — buttons, chips — as a capsule (`full`).
 */
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, xxl: 24, xxxl: 28, full: 999 } as const;

/** A corner of the scale, continuous. */
export function corner(size: keyof typeof radius): Pick<ViewStyle, 'borderRadius' | 'borderCurve'> {
  return { borderRadius: radius[size], borderCurve: 'continuous' };
}

/** A 4-point spacing scale. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48 } as const;

/** The margin between a screen's edge and its content. */
export const gutter = space[5];

/** 44-point minimum touch target, as on the website's buttons. */
export const hitTarget = 44;

/**
 * IBM Plex Sans Arabic for both scripts, as on the website. Arabic reads at 17
 * with generous leading and is never letter-spaced (tracking breaks its
 * joins); hierarchy comes from size and weight, headings at semibold rather
 * than bold.
 */
export const font = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const type = {
  display: { fontSize: 32, lineHeight: 46 },
  title: { fontSize: 22, lineHeight: 32 },
  headline: { fontSize: 18, lineHeight: 28 },
  body: { fontSize: 17, lineHeight: 30 },
  small: { fontSize: 15, lineHeight: 24 },
  caption: { fontSize: 13, lineHeight: 20 },
  label: { fontSize: 12, lineHeight: 18 },
} as const;

/**
 * Motion: a press settles the pressed thing slightly into the page, quickly in
 * and gently out. What arrives on a screen fades in as it rises a little way
 * (`appear`, `appearDistance`), its parts a beat apart (`stagger`); a step of
 * a flow slides in from the side the reading goes to (`step`). When the phone
 * asks for reduced motion nothing travels: things only fade (`fade`).
 */
export const motion = {
  pressScale: 0.97,
  pressIn: 90,
  pressOut: 180,
  appear: 460,
  appearDistance: 14,
  stagger: 70,
  step: 320,
  fade: 200,
} as const;
