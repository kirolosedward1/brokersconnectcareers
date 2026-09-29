/**
 * The website's design tokens, for the phone.
 *
 * Colours are src/app/globals.css's, converted from OKLCH to sRGB hex (the
 * website defines them in OKLCH; a few of its tints sit just outside sRGB, and
 * these are the nearest in-gamut values). Light is the default whatever the
 * phone's setting, as on the website; dark is the full palette the website's
 * toggle switches to.
 */
export const palette = {
  light: {
    background: '#FDFDFF',
    foreground: '#111826',
    card: '#FFFFFF',
    primary: '#2A4FF6',
    primaryPressed: '#1E38E1',
    primaryForeground: '#FAFCFF',
    secondary: '#EEF2FA',
    secondaryForeground: '#242D42',
    muted: '#F2F4F8',
    mutedForeground: '#626978',
    accent: '#BEF4F6',
    accentForeground: '#004753',
    success: '#187C49',
    successForeground: '#F7FEF9',
    successMuted: '#DAF7E3',
    warning: '#9B5E11',
    warningMuted: '#FFEFCD',
    destructive: '#C9302D',
    destructiveForeground: '#FFF9F8',
    destructiveMuted: '#FFEBE7',
    border: '#DADEE6',
    input: '#868C99',
    brandCyan: '#5CE1E6',
  },
  dark: {
    background: '#0B0F19',
    foreground: '#EFF2F7',
    card: '#131824',
    primary: '#6C97FF',
    primaryPressed: '#81ABFF',
    primaryForeground: '#040B22',
    secondary: '#202634',
    secondaryForeground: '#E1E5ED',
    muted: '#1C222E',
    mutedForeground: '#9298A5',
    accent: '#003B40',
    accentForeground: '#92F1F5',
    success: '#4AB074',
    successForeground: '#031108',
    successMuted: '#12301E',
    warning: '#E3AD4B',
    warningMuted: '#3B2B0D',
    destructive: '#EF6661',
    destructiveForeground: '#180807',
    destructiveMuted: '#3F1917',
    border: '#282E3B',
    input: '#686F7E',
    brandCyan: '#5CE1E6',
  },
} as const;

export type Scheme = keyof typeof palette;
export type Colors = { [K in keyof (typeof palette)['light']]: string };

/** The website's radius scale: 8 px base. */
export const radius = { sm: 4, md: 6, lg: 8, xl: 10, xxl: 12, xxxl: 14, full: 999 } as const;

/** A 4-point spacing scale. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;

/** 44-point minimum touch target, as on the website's buttons. */
export const hitTarget = 44;

/**
 * IBM Plex Sans Arabic for both scripts, as on the website. Arabic reads at 17
 * with generous leading and no negative tracking; headings are tighter.
 */
export const font = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const type = {
  body: { fontSize: 17, lineHeight: 30 },
  small: { fontSize: 15, lineHeight: 24 },
  caption: { fontSize: 13, lineHeight: 20 },
  title: { fontSize: 22, lineHeight: 31 },
  display: { fontSize: 28, lineHeight: 39 },
} as const;
