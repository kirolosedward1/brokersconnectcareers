/*
  Whether the app's alerts are turned: by the phone's own language, as iOS
  lays the alert out, not by React Native's direction (true in Expo Go).
*/
const mockLocales = { direction: 'ltr' as 'ltr' | 'rtl' };
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', textDirection: mockLocales.direction }],
}));
jest.mock('~/lib/direction', () => ({ appDirection: 'rtl', drawnDirection: () => 'rtl' as const, setDrawnLocale: () => {} }));

import { Alert, I18nManager, Platform } from 'react-native';
import { dialog, mirrored } from '~/lib/dialog';

beforeAll(() => {
  Platform.OS = 'ios';
  Object.defineProperty(I18nManager, 'isRTL', { value: true, configurable: true });
});

it('turns the buttons on an English iPhone even when React Native runs right to left (Expo Go)', () => {
  mockLocales.direction = 'ltr';
  expect(mirrored()).toBe(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  dialog.alert('تسحب طلبك؟', undefined, [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'اسحب الطلب', style: 'destructive' },
  ]);
  const given = alert.mock.calls[0][2]!;
  // Given in this order, iOS left to right draws Cancel on the right.
  expect(given.map((button) => button.text)).toEqual(['اسحب الطلب', 'إلغاء']);
  expect(given.some((button) => button.style === 'cancel')).toBe(false);
  alert.mockRestore();
});

it('leaves them to iOS on an Arabic iPhone, which lays the alert out right to left itself', () => {
  mockLocales.direction = 'rtl';
  expect(mirrored()).toBe(false);
});
