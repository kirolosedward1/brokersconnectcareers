import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { deleteAccountHere } from '~/features/account/delete';
import { setPushOff, dismissPushPrompt } from '~/features/push/device';
import { deviceNotes } from '~/features/saved/notes';
import { callAction } from '~/lib/api';
import { forgetPerson } from '~/lib/local-list';
import { supabase } from '~/lib/supabase';

/*
  A deleted account leaves nothing of itself on the phone: every list the app
  kept under the person's id, push's choices for them, and the reminders they
  had scheduled. Somebody else's, on the same phone, stay.
*/

jest.mock('~/lib/api', () => ({ ...jest.requireActual('~/lib/api'), callAction: jest.fn() }));

const GONE = '6f1c2a90-0000-4000-8000-00000000dead';
const STAYS = '6f1c2a90-0000-4000-8000-00000000beef';

const reminder = (id: string, notificationId: string) => ({
  id,
  slug: `job-${id}`,
  title: 'Closes tomorrow',
  body: 'Apply today',
  fireAt: Date.now() + 86_400_000,
  expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  notificationId,
  setAt: Date.now(),
});

async function keepFor(userId: string, notificationId: string) {
  await AsyncStorage.multiSet([
    [`bc.saved-notes.v1:${userId}`, JSON.stringify([{ id: 'job-1', text: 'Call Mona', updatedAt: 1 }])],
    [`bc.saved-reminders.v1:${userId}`, JSON.stringify([reminder('job-1', notificationId)])],
    [`bc.agent-searches.v1:${userId}`, '[]'],
    [`bc.wa-replies.v1:${userId}`, '[]'],
    [`bc.fewer-like-this.v1:${userId}`, '[]'],
    [`bc.recent-jobs.v1:${userId}`, '[]'],
    [`bc.recent-searches.v1:${userId}`, '["sales"]'],
    [`bc.board-seen.v1:${userId}`, '[]'],
  ]);
  await AsyncStorage.multiSet([
    ['auth:apple-sign-in', JSON.stringify({ userId, appleUser: '001234.abcd' })],
    ['bc.onboarding-intent.v1', JSON.stringify({ userId, intent: { next: '/jobs/sales-lead' } })],
  ]);
  await setPushOff(userId, true);
  await dismissPushPrompt(userId);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  deviceNotes.resetForTests();
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockClear();
  await AsyncStorage.setItem('bc.theme', 'dark');
  await keepFor(GONE, 'reminder-gone');
  await keepFor(STAYS, 'reminder-stays');
});

const keysOf = async (userId: string) => (await AsyncStorage.getAllKeys()).filter((key) => key.endsWith(`:${userId}`));

describe('forgetPerson', () => {
  it("removes every key kept under the person's id, and only theirs", async () => {
    expect(await keysOf(GONE)).toHaveLength(10);
    await forgetPerson(GONE);
    expect(await keysOf(GONE)).toEqual([]);
    expect(await keysOf(STAYS)).toHaveLength(10);
    expect(await AsyncStorage.getItem('bc.theme')).toBe('dark');
  });

  it('takes their scheduled reminders off the phone, not anybody else’s', async () => {
    await forgetPerson(GONE);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-gone');
  });

  it('lets go of what a list held in memory for them', async () => {
    expect(await deviceNotes.read(GONE)).toHaveLength(1);
    await forgetPerson(GONE);
    expect(await deviceNotes.read(GONE)).toEqual([]);
    expect(await deviceNotes.read(STAYS)).toHaveLength(1);
  });

  it('never throws when the phone will not answer', async () => {
    jest.spyOn(AsyncStorage, 'getAllKeys').mockRejectedValueOnce(new Error('storage gone'));
    await expect(forgetPerson(GONE)).resolves.toBeUndefined();
  });
});

describe('deleteAccountHere', () => {
  it('signs out and forgets the person once the website has deleted the account', async () => {
    jest.mocked(callAction).mockResolvedValueOnce({ ok: true } as never);
    const signOut = jest.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: null });
    const refusal = await deleteAccountHere({ id: GONE, identities: [], app_metadata: {} } as never);
    expect(refusal).toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await keysOf(GONE)).toEqual([]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-gone');
    expect(await keysOf(STAYS)).toHaveLength(10);
    expect(await AsyncStorage.getItem('auth:apple-sign-in')).toBeNull();
    expect(await AsyncStorage.getItem('bc.onboarding-intent.v1')).toBeNull();
  });

  it('keeps everything when the website refuses', async () => {
    jest.mocked(callAction).mockResolvedValueOnce({ ok: false, error: 'owns_company' } as never);
    expect(await deleteAccountHere({ id: GONE, identities: [], app_metadata: {} } as never)).toBe('owns_company');
    expect(await keysOf(GONE)).toHaveLength(10);
  });
});
