import type { ReactElement } from 'react';
import { I18nManager } from 'react-native';
import { render } from '@testing-library/react-native';
import { BackChevron, ForwardChevron } from '~/components/ui/icons';
import { ChevronLeft, ChevronRight } from '~/components/ui/lucide';
import { appDirection } from '~/lib/direction';

/*
  The app is Arabic only. Its direction is that language's, decided as this
  module loads, and every chevron follows it. Both signals the old code
  trusted are left to right here: the manifest has no `forcesRTL` (Expo Go
  applies that flag after the screen exists, and a test that mocks it true
  cannot see the miss), and `I18nManager.isRTL` is false. SDK 58 no longer
  turns iOS right to left from the phone's language, `forceRTL` applies on
  the next process start, and Expo Go resets that preference — a reload is
  not what corrects it. Onward still points left, and back points right.
*/

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

function glyph(element: ReactElement) {
  const view = render(element);
  return view.UNSAFE_root.findAll((node) => typeof node.props.d === 'string')
    .map((node) => node.props.d as string)
    .join('|');
}

it('lays the app out right to left while English is unpublished, with the manifest and React Native both left to right', () => {
  expect(I18nManager.isRTL).toBe(false);
  expect(appDirection).toBe('rtl');
});

it('points onward to the left and back to the right', () => {
  const onward = glyph(<ForwardChevron size={16} color="#ffffff" />);
  const back = glyph(<BackChevron size={16} color="#ffffff" />);
  expect(onward).toBe(glyph(<ChevronLeft size={16} color="#ffffff" />));
  expect(back).toBe(glyph(<ChevronRight size={16} color="#ffffff" />));
  expect(onward).not.toBe(back);
});
