jest.mock('expo-updates', () => ({ updateId: null, createdAt: null }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    executionEnvironment: 'storeClient',
    manifest2: { id: 'b53701d9-df9b-462e-bb85-706e40f1f983', createdAt: '2026-10-19T08:23:12.813Z' },
    expoConfig: { version: '1.0.0', extra: { commit: 'bf03953' } },
  },
  ExecutionEnvironment: { StoreClient: 'storeClient', Standalone: 'standalone', Bare: 'bare' },
}));

import { buildMarker } from '~/features/update';

/* Expo Go keeps the copy it opened: Account says which one, to the letter. */
it('names the update and the commit the phone runs', () => {
  expect(buildMarker()).toBe('b53701d9 · bf03953');
});
