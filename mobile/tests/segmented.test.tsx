import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Segmented } from '~/components/ui/segmented';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  The board's sort and Account's appearance: one of a few. At the phone's
  ordinary text sizes, a radio group drawn as iOS's segmented control; at the
  accessibility sizes, where three options side by side are cut short and
  stacked they filled the board's first screen, one row naming the choice
  that opens the options. The store smoke run's largest-text pass found the
  stacked version pushing the board's results off the screen.
*/

const mockWindow = { width: 440, height: 956, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const ar = catalogues.ar;

const metrics = { frame: { x: 0, y: 0, width: 440, height: 956 }, insets: { top: 62, bottom: 34, left: 0, right: 0 } };

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
  { value: 'seats', label: ar.jobs.sortSeats },
] as const;

function Sort({ onChange }: { onChange: (value: (typeof options)[number]['value']) => void }) {
  return <Segmented label={ar.jobs.sortBy} value="newest" options={[...options]} onChange={onChange} />;
}

afterEach(() => {
  mockWindow.fontScale = 1;
});

describe('one of a few', () => {
  it('is a radio group of radio buttons at the ordinary text sizes', () => {
    const onChange = jest.fn();
    render(<Sort onChange={onChange} />, { wrapper: Providers });

    expect(screen.getByLabelText(ar.jobs.sortBy).props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: ar.jobs.sortNewest }).props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(screen.getByRole('radio', { name: ar.jobs.sortSalary }));
    expect(onChange).toHaveBeenCalledWith('salary');
  });

  it('is one row naming the choice at the accessibility sizes, opening the options in a sheet', () => {
    mockWindow.fontScale = 2;
    const onChange = jest.fn();
    render(<Sort onChange={onChange} />, { wrapper: Providers });

    // Nothing stacked: no radio group on the page itself, one button that says what is chosen.
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const row = screen.getByRole('button', { name: `${ar.jobs.sortBy}: ${ar.jobs.sortNewest}` });
    expect(screen.queryByRole('radio')).toBeNull();

    fireEvent.press(row);
    expect(screen.getByRole('radio', { name: ar.jobs.sortNewest }).props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(screen.getByRole('radio', { name: ar.jobs.sortSeats }));
    expect(onChange).toHaveBeenCalledWith('seats');
  });

  it('does not answer the choice already made', () => {
    mockWindow.fontScale = 2;
    const onChange = jest.fn();
    render(<Sort onChange={onChange} />, { wrapper: Providers });

    fireEvent.press(screen.getByRole('button', { name: `${ar.jobs.sortBy}: ${ar.jobs.sortNewest}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.jobs.sortNewest }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
