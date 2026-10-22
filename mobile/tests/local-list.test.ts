import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLocalList, forgetOwner } from '~/lib/local-list';

/*
  What a person keeps on the phone goes with their account (forgetOwner,
  called once the account is deleted), and nothing still on its way to
  storage brings it back: a search's alert checked as the app opened, a
  note's Undo, a reminder put back, each finishing after the deletion.
*/

type Item = { id: string };
const isItem = (item: unknown): item is Item => typeof (item as Item | null)?.id === 'string';

let n = 0;
const list = () => createLocalList<Item>(`bc.test-${++n}.v1`, { max: 10, idOf: (item) => item.id, valid: isItem });

beforeEach(async () => {
  await AsyncStorage.clear();
});

it("takes the person's lists off the phone, and leaves everybody else's", async () => {
  const notes = list();
  await AsyncStorage.multiSet([
    [`bc.test-${n}.v1:gone`, JSON.stringify([{ id: 'a' }])],
    [`bc.test-${n}.v1:stays`, JSON.stringify([{ id: 'b' }])],
    ['push:off:gone', '1'],
  ]);
  expect(await notes.read('gone')).toEqual([{ id: 'a' }]);

  await forgetOwner('gone');

  expect(await AsyncStorage.getItem(`bc.test-${n}.v1:gone`)).toBeNull();
  expect(await AsyncStorage.getItem('push:off:gone')).toBeNull();
  expect(await AsyncStorage.getItem(`bc.test-${n}.v1:stays`)).not.toBeNull();
});

it('lets no write that was on its way bring them back', async () => {
  const notes = list();
  await AsyncStorage.setItem(`bc.test-${n}.v1:gone`, JSON.stringify([{ id: 'a' }]));

  // Added while the list was still being read from the phone, then the account deleted.
  notes.add('gone', { id: 'b' });
  await forgetOwner('gone');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await AsyncStorage.getItem(`bc.test-${n}.v1:gone`)).toBeNull();

  // Changed after the deletion, from a copy read before it.
  notes.update('gone', 'a', (item) => item);
  notes.add('gone', { id: 'c' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await AsyncStorage.getItem(`bc.test-${n}.v1:gone`)).toBeNull();
  expect(await notes.read('gone')).toEqual([]);
});
