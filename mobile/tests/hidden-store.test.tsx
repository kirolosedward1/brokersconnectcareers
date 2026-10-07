import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';
import { createHiddenStore, totalShown } from '~/features/moderation/hidden-store';

/*
  What the reader hides on this phone (hidden-store.ts): the ids every list
  leaves out, and the names Account → "Hidden on this phone" lists them by.
*/

const KEY = 'bc.test-hidden.v1';
const store = createHiddenStore(KEY);

function Probe() {
  const ids = store.useHidden();
  const entries = store.useEntries();
  return <Text>{`${[...ids].join(',')}|${entries.map((entry) => entry.name ?? '-').join(',')}`}</Text>;
}

it('reads a list kept before names were, keeps the names given since, and skips what it cannot read', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify(['old', { id: 'named', name: 'شركة', slug: 'sharika' }, 5, { name: 'no id' }]));
  render(<Probe />);
  expect(await screen.findByText('old,named|-,شركة')).toBeTruthy();

  act(() => store.hide('new', { name: 'منى علي', slug: 'mona-ali' }));
  expect(screen.getByText('old,named,new|-,شركة,منى علي')).toBeTruthy();
  expect(JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]')).toEqual([
    { id: 'old', name: null, slug: null },
    { id: 'named', name: 'شركة', slug: 'sharika' },
    { id: 'new', name: 'منى علي', slug: 'mona-ali' },
  ]);

  act(() => store.unhide('named'));
  expect(screen.getByText('old,new|-,منى علي')).toBeTruthy();
});

it('counts a list without what this phone hides, never below what is shown', () => {
  // 30 in all; 24 read, 2 of them hidden: 28 is the best the phone knows.
  expect(totalShown(30, 24, 22)).toBe(28);
  // Read to the end: exact.
  expect(totalShown(3, 3, 2)).toBe(2);
  // A total older than the rows (a listing added since): never below what is on screen.
  expect(totalShown(1, 3, 3)).toBe(3);
});
