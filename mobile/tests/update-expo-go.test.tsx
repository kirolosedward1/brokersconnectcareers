/*
  The update floor in Expo Go: the native version there is Expo Go's own, so
  the app's floor is read against this app's version (the config's), not it.
*/
import { renderHook } from '@testing-library/react-native';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.33.0' }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'storeClient', expoConfig: { version: '1.0.0' } },
  ExecutionEnvironment: { StoreClient: 'storeClient', Standalone: 'standalone', Bare: 'bare' },
}));
jest.mock('expo-updates', () => ({ createdAt: null }));
jest.mock('~/features/config', () => ({
  useMobileConfig: () => ({ data: { minAppVersion: '1.1.0', appStoreUrl: null } }),
}));

import { useUpdateRequired } from '~/features/update';

it('asks for an update when this app, not Expo Go, is below the floor', () => {
  const { result } = renderHook(() => useUpdateRequired());
  expect(result.current.required).toBe(true);
});
