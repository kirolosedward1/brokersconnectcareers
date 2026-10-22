import { useCallback, useMemo, useState } from 'react';
import { AppState, Pressable, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DRAFT_MAX_AGE_MS } from '@/lib/form-draft';
import { draftKey, dropDraft, forgetKeptDrafts, keepDraft, pruneKeptDrafts, readKeptDraft } from '~/lib/kept-draft';
import { useKeptDraft } from '~/lib/use-kept-draft';

/*
  What a form keeps on the phone while it is typed (kept-draft.ts,
  use-kept-draft.ts): iOS ending the app in the background asks nobody, and
  until this an employer's half-written listing went with it.
*/

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const KEY = draftKey('test', 'user-a', 'rec');

beforeEach(async () => {
  await AsyncStorage.clear();
  // React Native's mock answers with nothing; the app removes what it subscribed.
  jest.mocked(AppState.addEventListener).mockClear().mockReturnValue({ remove: jest.fn() } as never);
});

/** The app leaving the front, as iOS tells React Native. */
function goToBackground() {
  const listeners = jest
    .mocked(AppState.addEventListener)
    .mock.calls.filter(([type]) => type === 'change')
    .map(([, listener]) => listener as (next: string) => void);
  listeners.forEach((listener) => listener('background'));
}

describe('the store', () => {
  it('keeps a draft under the account and the record, and nobody else reads it', async () => {
    expect(KEY).toBe('bc-draft:test:user-a:rec');
    expect(await keepDraft(KEY, { note: 'متاح فوراً' }, '3', NOW)).toBe(true);
    expect(await readKeptDraft(KEY, NOW + 1000)).toEqual({ values: { note: 'متاح فوراً' }, savedAt: NOW, base: '3' });
    expect(await readKeptDraft(draftKey('test', 'user-b', 'rec'), NOW)).toBeNull();
    await dropDraft(KEY);
    expect(await readKeptDraft(KEY, NOW)).toBeNull();
  });

  it('keeps it a week, no longer, and throws away what it cannot read', async () => {
    await keepDraft(KEY, { a: 1 }, null, NOW);
    expect(await readKeptDraft(KEY, NOW + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();

    await AsyncStorage.setItem(KEY, '{not json');
    expect(await readKeptDraft(KEY, NOW)).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();

    expect(await keepDraft(KEY, { long: 'x'.repeat(70_000) }, null, NOW)).toBe(false);
  });

  it('prunes the stale ones and forgets every draft on signing out, and nothing else', async () => {
    await AsyncStorage.setItem('bc.theme', 'dark');
    await keepDraft(draftKey('apply', 'user-a', 'j1'), { a: 1 }, null, NOW);
    await keepDraft(draftKey('job', 'user-b'), { b: 1 }, null, NOW - DRAFT_MAX_AGE_MS - 1);
    await pruneKeptDrafts(NOW);
    expect((await AsyncStorage.getAllKeys()).slice().sort()).toEqual(['bc-draft:apply:user-a:j1', 'bc.theme']);
    await forgetKeptDrafts();
    expect(await AsyncStorage.getAllKeys()).toEqual(['bc.theme']);
  });
});

function Probe({ base = null, initial = '' }: { base?: string | null; initial?: string }) {
  const [text, setText] = useState(initial);
  // Where a wizard is, kept with its fields but not itself typing.
  const [step, setStep] = useState(0);
  const draft = useKeptDraft({
    key: KEY,
    values: useMemo(() => ({ text, step }), [text, step]),
    restore: useCallback((held: { text: string; step?: number }) => {
      setText(held.text);
      setStep(held.step ?? 0);
    }, []),
    typed: (held) => held.text,
    base,
  });
  return (
    <>
      <TextInput testID="text" value={text} onChangeText={setText} />
      <Text testID="state">{`${draft.restoredAt ? 'restored' : ''}${draft.offeredAt ? 'offered' : ''}`}</Text>
      <Pressable testID="accept" onPress={draft.accept} />
      <Pressable testID="discard" onPress={draft.discard} />
      <Pressable testID="clear" onPress={draft.clear} />
      <Pressable testID="next" onPress={() => setStep((current) => current + 1)} />
    </>
  );
}

const stored = async () => {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as { base: string | null; values: { text: string } }) : null;
};
const value = () => screen.getByTestId('text').props.value as string;

describe('a form that keeps its draft', () => {
  it('writes what is typed, and puts it back when the form opens again', async () => {
    const first = render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('state')).toBeTruthy());
    expect(await stored()).toBeNull();

    fireEvent.changeText(screen.getByTestId('text'), 'وكيل مبيعات');
    await waitFor(async () => expect((await stored())?.values).toEqual({ text: 'وكيل مبيعات', step: 0 }));
    first.unmount();

    render(<Probe />);
    await waitFor(() => expect(value()).toBe('وكيل مبيعات'));
    expect(screen.getByTestId('state').props.children).toBe('restored');
  });

  it('puts a draft back without dropping it or making it younger: its week runs from when it was typed', async () => {
    const typedAt = Date.now() - 60 * 60 * 1000;
    await keepDraft(KEY, { text: 'كُتب من ساعة', step: 0 }, null, typedAt);
    // The mock's removeItem is a jest.fn already: its calls are counted from here, not from the tests before.
    const removals = () => jest.mocked(AsyncStorage.removeItem).mock.calls.filter(([key]) => key === KEY).length;
    const before = removals();
    render(<Probe />);
    await waitFor(() => expect(value()).toBe('كُتب من ساعة'));
    // Past the pause a write would wait for.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(removals()).toBe(before);
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null')?.at).toBe(typedAt);
  });

  it('writes at once when the app leaves the foreground, without waiting for the pause', async () => {
    render(<Probe />);
    await act(async () => {});
    fireEvent.changeText(screen.getByTestId('text'), 'قبل ما iOS يقفل');
    await act(async () => goToBackground());
    expect((await stored())?.values.text).toBe('قبل ما iOS يقفل');
  });

  it('starts over: the form is as it opened and nothing is kept', async () => {
    await keepDraft(KEY, { text: 'old work' });
    render(<Probe />);
    await waitFor(() => expect(value()).toBe('old work'));
    fireEvent.press(screen.getByTestId('discard'));
    await waitFor(async () => expect(await stored()).toBeNull());
    expect(value()).toBe('');
    expect(screen.getByTestId('state').props.children).toBe('');
  });

  it('once sent, keeps nothing more of it', async () => {
    render(<Probe />);
    await act(async () => {});
    fireEvent.changeText(screen.getByTestId('text'), 'sent');
    await waitFor(async () => expect(await stored()).not.toBeNull());
    fireEvent.press(screen.getByTestId('clear'));
    await waitFor(async () => expect(await stored()).toBeNull());
  });

  it('offers a draft typed over an older version instead of pouring it in, and accepting puts it in', async () => {
    await keepDraft(KEY, { text: 'over v1' }, '1');
    render(<Probe base="2" initial="server" />);
    await waitFor(() => expect(screen.getByTestId('state').props.children).toBe('offered'));
    expect(value()).toBe('server');
    // Held while it waits for an answer, not written over.
    expect((await stored())?.values.text).toBe('over v1');

    fireEvent.press(screen.getByTestId('accept'));
    await waitFor(() => expect(value()).toBe('over v1'));
    await waitFor(async () => expect((await stored())?.base).toBe('2'));
  });

  it('does not take moving between steps as the answer to an offer: only typing is', async () => {
    await keepDraft(KEY, { text: 'over v1', step: 2 }, '1');
    render(<Probe base="2" initial="server" />);
    await waitFor(() => expect(screen.getByTestId('state').props.children).toBe('offered'));
    // Looking at the current version before deciding.
    fireEvent.press(screen.getByTestId('next'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(screen.getByTestId('state').props.children).toBe('offered');
    expect((await stored())?.values).toEqual({ text: 'over v1', step: 2 });
  });

  it('takes typing past an offer as the answer: the new work replaces the old draft', async () => {
    await keepDraft(KEY, { text: 'over v1' }, '1');
    render(<Probe base="2" initial="server" />);
    await waitFor(() => expect(screen.getByTestId('state').props.children).toBe('offered'));
    fireEvent.changeText(screen.getByTestId('text'), 'fresh');
    await waitFor(async () => expect((await stored())?.values.text).toBe('fresh'));
    expect(screen.getByTestId('state').props.children).toBe('');
  });
});
