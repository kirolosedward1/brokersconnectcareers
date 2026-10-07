import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SearchField } from '~/components/ui/search-field';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  A list's search, the app's own rather than iOS's: iOS lays its search bar
  out by the phone's language, so on an iPhone set to English, and in Expo
  Go, it ran left to right under the Arabic. This one runs with the app.
*/

// The app as Expo Go and a phone not set to Arabic run it: right to left by its own say (app.config.ts).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { forcesRTL: true } } },
}));

const ar = catalogues.ar;
const searched: string[] = [];

function List({ start = '' }: { start?: string }) {
  const [words, setWords] = useState(start);
  return (
    <>
      <SearchField
        value={words}
        label="بحث"
        placeholder="مثال: مدير مبيعات"
        onSearch={(next) => {
          searched.push(next);
          setWords(next);
        }}
      />
      {/* What a chip does: takes the words off from outside the field. */}
      <SearchField value={words} label="الكلمات من بره" placeholder="" onSearch={() => {}} />
      <Pressable accessibilityRole="button" accessibilityLabel="chip" onPress={() => setWords('')} />
    </>
  );
}

function draw(start?: string) {
  searched.length = 0;
  render(
    <ThemeProvider>
      <I18nProvider>
        <List start={start} />
      </I18nProvider>
    </ThemeProvider>,
  );
}

it("types from the right and searches with the keyboard's Search key", () => {
  draw();
  const field = screen.getByLabelText('بحث');
  expect(StyleSheet.flatten(field.props.style).textAlign).toBe('right');
  expect(field.props.returnKeyType).toBe('search');

  fireEvent.changeText(field, `  ${'م'.repeat(130)}  `);
  fireEvent(field, 'submitEditing');
  // Trimmed, and no longer than the website lets a search be.
  expect(searched).toEqual(['م'.repeat(120)]);
});

it('empties with its clear mark, which drops the search only when there was one', () => {
  draw('ريسيل');
  const field = screen.getByLabelText('بحث');
  expect(field.props.value).toBe('ريسيل');
  fireEvent.press(screen.getAllByRole('button', { name: ar.app.search.clear })[0]);
  expect(searched).toEqual(['']);
  expect(screen.getByLabelText('بحث').props.value).toBe('');
  expect(screen.queryAllByRole('button', { name: ar.app.search.clear })).toHaveLength(0);

  // Typed but never searched: clearing it asks nothing of the list.
  fireEvent.changeText(screen.getByLabelText('بحث'), 'مبيعات');
  fireEvent.press(screen.getByRole('button', { name: ar.app.search.clear }));
  expect(searched).toEqual(['']);
});

it('says the words whichever way they change: typed here, or taken off by a chip', () => {
  draw('ريسيل');
  expect(screen.getByLabelText('الكلمات من بره').props.value).toBe('ريسيل');
  fireEvent.press(screen.getByRole('button', { name: 'chip' }));
  expect(screen.getByLabelText('بحث').props.value).toBe('');
  expect(screen.getByLabelText('الكلمات من بره').props.value).toBe('');
});
