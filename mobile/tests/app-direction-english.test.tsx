import { I18nManager } from 'react-native';
import { appDirection } from '~/lib/direction';

/*
  English published, and nothing else asking for right to left: the manifest
  flag is absent and the phone is left to right. Direction then stays left to
  right. While English is unpublished the other file expects Arabic anyway;
  this one keeps that from becoming unconditional.
*/

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

jest.mock('@/lib/locale', () => {
  const actual = jest.requireActual('@/lib/locale') as typeof import('@/lib/locale');
  return { ...actual, ENGLISH_ENABLED: true };
});

it('stays left to right once English is published, when the manifest does not force a direction and the phone does not either', () => {
  expect(I18nManager.isRTL).toBe(false);
  expect(appDirection).toBe('ltr');
});
