import { Image, View } from 'react-native';
import { palette } from '~/theme/tokens';

/** The launch screen's own picture and size (app.config.ts, expo-splash-screen). */
const MARK = require('../../../assets/images/splash-icon.png');
const MARK_SIZE = 76;

/**
 * What the app shows while it is still getting ready — its font, who is
 * signed in, the listings the reader hid: the logo mark alone, centred on the
 * page colour, exactly where the phone's launch screen draws it. Wherever the
 * launch screen comes down early (Expo Go lowers it as soon as the code
 * runs), the app goes on showing the same mark rather than an empty page.
 * Drawn before the theme and the catalogue exist, so it takes neither.
 */
export function LaunchScreen() {
  return (
    <View
      testID="launch-screen"
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.light.background }}
    >
      <Image source={MARK} style={{ width: MARK_SIZE, height: MARK_SIZE }} resizeMode="contain" />
    </View>
  );
}
