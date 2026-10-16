import type { ReactNode } from 'react';
import { Modal } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SortMenu } from '~/components/jobs/sort-menu';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  The board's order: a small button opening the orders in a card. A new order
  reloads the board, which draws the button afresh; taken away while iOS was
  still fading the card out, the next sheet asked for — the filters — was
  never shown, and its button did nothing (the Expo Go look's tour: by salary,
  then the filters). So the order is applied once the card has gone.
*/

const ar = catalogues.ar;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } };

function Providers({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const options = [
  { value: 'newest', label: ar.jobs.sortNewest },
  { value: 'salary', label: ar.jobs.sortSalary },
] as const;

function open(onChange: (value: 'newest' | 'salary') => void) {
  render(<SortMenu label={ar.jobs.sortBy} value="newest" options={[...options]} onChange={onChange} />, { wrapper: Providers });
  fireEvent.press(screen.getByRole('button', { name: `${ar.jobs.sortBy}: ${ar.jobs.sortNewest}` }));
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('applies a new order once the card has gone, not while it is still closing', () => {
  const onChange = jest.fn();
  open(onChange);
  fireEvent.press(screen.getByRole('radio', { name: ar.jobs.sortSalary }));
  // Closing: the card is still there, fading, and the board not yet reloaded under it.
  expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false);
  expect(onChange).not.toHaveBeenCalled();

  // iOS says it has gone.
  act(() => screen.UNSAFE_getByType(Modal).props.onDismiss());
  expect(onChange).toHaveBeenCalledWith('salary');
  expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
});

it('applies it all the same when iOS never says the card has gone', () => {
  const onChange = jest.fn();
  open(onChange);
  fireEvent.press(screen.getByRole('radio', { name: ar.jobs.sortSalary }));
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('salary');
});

it('closes without a word to the board when the order chosen is the one already shown', () => {
  const onChange = jest.fn();
  open(onChange);
  fireEvent.press(screen.getByRole('radio', { name: ar.jobs.sortNewest }));
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
});
