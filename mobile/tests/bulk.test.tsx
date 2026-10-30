import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BulkBar, PickBox } from '~/components/employer/bulk-bar';
import { ReasonTick } from '~/components/employer/reason-tick';
import type { Applicant } from '~/features/employer/applicants';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { LRI, PDI } from '~/i18n/rich';
import { ThemeProvider } from '~/theme/provider';

/*
  The inbox's select mode (Phase B 01) and the reason tick it shares with one
  applicant's card: what each says, right to left and at the largest text
  size.
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

const applicant = (id: string, status: Applicant['status']) => ({ id, status }) as Applicant;
const selected = [applicant('a1', 'new'), applicant('a2', 'shortlisted')];

const view = () => (
  <Providers>
    <PickBox name="سارة عادل" selected onToggle={() => {}} />
    <ReasonTick shared={false} onChange={() => {}} />
    <BulkBar selected={selected} onDone={() => {}} />
  </Providers>
);

describe('the select bar', () => {
  it('says how many are chosen, and offers the three moves and a way out', () => {
    render(view());
    expect(screen.getByTestId('bulk-count').props.children).toBe(`${ar.app.bulk.selected.replace('<v>{count}</v>', `${LRI}2${PDI}`)}`);
    for (const label of [ar.app.bulk.move, ar.app.bulk.message, ar.app.bulk.decline, ar.app.bulk.done]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('says what the reason tick means, on and off', () => {
    const onChange = jest.fn();
    render(
      <Providers>
        <ReasonTick shared={false} onChange={onChange} />
      </Providers>,
    );
    expect(screen.getByText(ar.app.applicants.reasonPrivateHint)).toBeTruthy();
    fireEvent.press(screen.getByRole('checkbox', { name: ar.employer.decisionNoteVisible }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('draws right to left', () => {
    expect(render(view()).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(view()).toJSON()).toMatchSnapshot();
  });
});
