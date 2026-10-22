import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SendForward, SignInMark, SignOutMark } from '~/components/ui/icons';
import { appDirection } from '~/lib/direction';

// The app as Expo Go and a phone not set to Arabic run it: right to left by its own say (app.config.ts).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { forcesRTL: true } } },
}));

/*
  The glyphs that turn to face the reading in Arabic — signing in and out,
  sending — turn as a view, about its middle. A turn put on the drawing itself
  is taken by react-native-svg about the drawing's corner, out of its own box:
  the Account tab's sign-out row showed an empty tile.
*/

it('runs right to left, as the app does', () => {
  expect(appDirection).toBe('rtl');
});

it.each([
  ['sign in', SignInMark],
  ['sign out', SignOutMark],
  ['send', SendForward],
])('turns "%s" as a view around the drawing, leaving the drawing itself untouched', (_name, Mark) => {
  render(<Mark size={18} color="#16295A" />);
  const turned = screen.getByTestId('mirrored');
  expect(StyleSheet.flatten(turned.props.style).transform).toEqual([{ scaleX: -1 }]);
  const alsoTurned = screen.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && node.props.testID !== 'mirrored' && Boolean(StyleSheet.flatten(node.props.style)?.transform),
  );
  expect(alsoTurned).toEqual([]);
});
