import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLocalList, forgetOwner } from '~/lib/local-list';

/*
  A deleted account leaves nothing of its own on the phone: every list kept
  under its id and the push choices keyed the same way go; what another
  person keeps, and what is the phone's own, stays.
*/
type Note = { id: string; text: string };
const notes = createLocalList<Note>('test.notes.v1', {
  max: 10,
  idOf: (item) => item.id,
  valid: (item): item is Note => typeof (item as Note | null)?.id === 'string',
});

beforeEach(async () => {
  await AsyncStorage.clear();
  notes.resetForTests();
});

it("takes one person's lists and push choices off the phone, and nobody else's", async () => {
  notes.add('alice', { id: 'j1', text: 'call back' });
  notes.add('bob', { id: 'j2', text: 'ask about commission' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await AsyncStorage.setItem('push:off:alice', '1');
  await AsyncStorage.setItem('push:prompt-dismissed:alice', '1');
  await AsyncStorage.setItem('bc-theme', 'dark');

  await forgetOwner('alice');

  expect(await notes.read('alice')).toEqual([]);
  expect(await AsyncStorage.getItem('test.notes.v1:alice')).toBeNull();
  expect(await AsyncStorage.getItem('push:off:alice')).toBeNull();
  expect(await AsyncStorage.getItem('push:prompt-dismissed:alice')).toBeNull();
  // Bob's, and the phone's own, untouched.
  expect(await notes.read('bob')).toEqual([{ id: 'j2', text: 'ask about commission' }]);
  expect(await AsyncStorage.getItem('bc-theme')).toBe('dark');
});

it('leaves the list usable afterwards', async () => {
  notes.add('alice', { id: 'j1', text: 'one' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await forgetOwner('alice');
  notes.add('alice', { id: 'j3', text: 'again' });
  expect(await notes.read('alice')).toEqual([{ id: 'j3', text: 'again' }]);
});
