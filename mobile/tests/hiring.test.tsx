import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CompanyContact, PausedNotice } from '~/components/companies/hiring-notice';
import { HiringSettings } from '~/components/employer/hiring-settings';
import { dayRuns, isHiringNow, type CompanyHiring } from '~/features/companies/hiring';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { LRI, PDI } from '~/i18n/rich';
import { ThemeProvider } from '~/theme/provider';

/*
  A company says when it hires (Phase B 07a): the notice on a paused
  company's listing and page, its contact and reply hours, and the admin's
  settings — right to left and at the largest text size.
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

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 34 } }}>
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const paused: CompanyHiring = {
  status: 'paused',
  pausedUntil: '2026-11-15',
  open: false,
  whatsapp: '+201055500123',
  replyHours: { days: [0, 1, 2, 3, 4], from: '10:00', to: '18:00' },
};

describe('isHiringNow', () => {
  it('reads a pause as company_is_hiring() does: over once its day has passed in Cairo', () => {
    expect(isHiringNow('open', null, '2026-11-01')).toBe(true);
    expect(isHiringNow('paused', null, '2026-11-01')).toBe(false);
    expect(isHiringNow('paused', '2026-11-15', '2026-11-15')).toBe(false);
    expect(isHiringNow('paused', '2026-11-15', '2026-11-16')).toBe(true);
  });
});

describe('dayRuns', () => {
  const name = (day: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]!;
  it('writes three days or more in a row as a range, and lists the rest', () => {
    expect(dayRuns([0, 1, 2, 3, 4], name, ', ')).toBe('Sun–Thu');
    expect(dayRuns([4, 0, 6], name, ', ')).toBe('Sun, Thu, Sat');
    expect(dayRuns([0, 1, 3, 4, 5], name, ', ')).toBe('Sun, Mon, Wed–Fri');
  });
});

describe('PausedNotice and CompanyContact', () => {
  const view = (
    <Providers>
      <PausedNotice hiring={paused} />
      <CompanyContact name="شركة النيل" hiring={paused} />
    </Providers>
  );

  it('says the company takes no application, until when, and when it answers with its times isolated', () => {
    render(view);
    expect(screen.getByText(ar.app.hiring.pausedTitle)).toBeTruthy();
    const hours = screen.getByTestId('reply-hours');
    const text = JSON.stringify(hours.props.children);
    expect(text).toContain(`${LRI}10:00${PDI}`);
    expect(text).toContain('الأحد–الخميس');
    expect(screen.getByRole('button', { name: ar.app.contact.whatsappTo.replace('{name}', 'شركة النيل') })).toBeTruthy();
    // The company gave a WhatsApp number, not one to call.
    expect(screen.queryByRole('button', { name: ar.app.contact.callTo.replace('{name}', 'شركة النيل') })).toBeNull();
  });

  it('draws right to left', () => {
    expect(render(view).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(view).toJSON()).toMatchSnapshot();
  });
});

describe('HiringSettings', () => {
  const settings = (
    <Providers>
      <HiringSettings companyId="c1" hiring={paused} />
    </Providers>
  );

  it('opens on what is stored: paused, the number, the hours', () => {
    render(settings);
    expect(screen.getByTestId('hiring-open').props.value).toBe(false);
    expect(screen.getByLabelText(ar.app.hiring.whatsapp).props.value).toBe('+201055500123');
    expect(screen.getByTestId('hiring-hours').props.value).toBe(true);
  });

  it('draws right to left', () => {
    expect(render(settings).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(settings).toJSON()).toMatchSnapshot();
  });
});
