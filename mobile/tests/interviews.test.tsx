import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { InterviewTimeFields } from '~/components/interviews/interview-fields';
import { cairoDay, cairoInstant, INTERVIEW_TIMES, nextCairoDays } from '~/features/interviews/cairo-time';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  Interview times (migration 373) are chosen and shown in Cairo time and
  stored as instants: Cairo's offset is the time zone database's for the
  day, summer time included. And the picker, right to left and at the
  largest text size.
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

describe('Cairo time', () => {
  it("writes a wall-clock time with Cairo's offset for that day", () => {
    // Winter: UTC+2. Summer time (from late April 2026 to late October): UTC+3.
    expect(cairoInstant('2026-01-15', '11:00')).toBe('2026-01-15T11:00:00+02:00');
    expect(cairoInstant('2026-07-15', '11:00')).toBe('2026-07-15T11:00:00+03:00');
    expect(new Date(cairoInstant('2026-01-15', '11:00')).toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it("counts days on Cairo's calendar, today first", () => {
    // 23:30 UTC on the 1st is already the 2nd in Cairo.
    const lateNight = new Date('2026-01-01T23:30:00Z');
    expect(cairoDay(lateNight)).toBe('2026-01-02');
    expect(nextCairoDays(lateNight, 3)).toEqual(['2026-01-02', '2026-01-03', '2026-01-04']);
  });

  it('offers the working day in half hours', () => {
    expect(INTERVIEW_TIMES[0]).toBe('09:00');
    expect(INTERVIEW_TIMES.at(-1)).toBe('21:00');
    expect(INTERVIEW_TIMES).toHaveLength(25);
  });
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const NOW = Date.parse('2026-11-01T08:00:00Z');
const fields = (
  <Providers>
    <InterviewTimeFields now={NOW} day="2026-11-02" time="11:00" onDay={() => {}} onTime={() => {}} />
  </Providers>
);

describe('the day and time fields', () => {
  it('name today and tomorrow, and say the time is Cairo time', () => {
    render(fields);
    expect(screen.getByText(ar.app.interview.today)).toBeTruthy();
    expect(screen.getByText(ar.app.interview.tomorrow)).toBeTruthy();
    expect(screen.getByText(` · ${ar.app.interview.cairoTime}`)).toBeTruthy();
  });

  it('draw right to left', () => {
    expect(render(fields).toJSON()).toMatchSnapshot();
  });

  it('draw at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(fields).toJSON()).toMatchSnapshot();
  });
});
