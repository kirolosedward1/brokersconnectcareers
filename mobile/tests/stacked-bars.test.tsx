import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StackedBars } from '~/components/dashboard/stacked-bars';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  The admin's platform activity, stacked (the Admin board): a week, a month
  or a quarter of the days given, a tap for one day's figures, the days a
  VoiceOver swipe away — right to left, and at the largest text size.
*/

const mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

afterEach(() => {
  mockWindow.fontScale = 1;
});

const ar = catalogues.ar;
const DAYS = Array.from({ length: 180 }, (_, index) => new Date(Date.UTC(2026, 4, 3 + index)).toISOString().slice(0, 10));

function Providers({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const chart = (
  <Providers>
    <StackedBars
      title="نشاط المنصة"
      days={DAYS}
      series={[
        { key: 'applications', label: 'طلبات', color: '#16295A', values: DAYS.map((_, index) => index % 4) },
        { key: 'published', label: 'إعلانات نُشرت', color: '#A27A3B', values: DAYS.map((_, index) => index % 3) },
        { key: 'signups', label: 'حسابات جديدة', color: '#5CE1E6', values: DAYS.map(() => 1) },
      ]}
      empty="لا نشاط"
    />
  </Providers>
);

describe('the stacked activity chart', () => {
  it('draws the last thirty days, then a week or a quarter as chosen', () => {
    render(chart);
    expect(screen.getAllByTestId('chart-day')).toHaveLength(30);
    fireEvent.press(screen.getByRole('radio', { name: new RegExp(ar.app.chart.range7.replace(/<\/?v>/g, '.?')) }));
    expect(screen.getAllByTestId('chart-day')).toHaveLength(7);
    fireEvent.press(screen.getByRole('radio', { name: new RegExp(ar.app.chart.range90.replace(/<\/?v>/g, '.?')) }));
    expect(screen.getAllByTestId('chart-day')).toHaveLength(90);
  });

  it("says one day's figures on a tap, and hides them on a second", () => {
    render(chart);
    const days = screen.getAllByTestId('chart-day');
    fireEvent.press(days[29]);
    expect(screen.getByTestId('chart-tooltip')).toBeTruthy();
    fireEvent.press(days[29]);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('steps through the days for VoiceOver, each said with its figures', () => {
    render(chart);
    const adjustable = screen.getByRole('adjustable');
    act(() => adjustable.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    expect(screen.getByRole('adjustable').props.accessibilityValue.text).toMatch(/طلبات: \d+، إعلانات نُشرت: \d+، حسابات جديدة: 1$/);
  });

  it('draws right to left', () => {
    expect(render(chart).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(chart).toJSON()).toMatchSnapshot();
  });
});
