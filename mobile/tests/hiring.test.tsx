import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CompanyContact, PausedNotice } from '~/components/companies/hiring-notice';
import { RecordRow } from '~/components/applications/cleared-applications';
import { HiringSettings } from '~/components/employer/hiring-settings';
import { OwnershipSettings } from '~/components/employer/ownership-settings';
import { RulesSettings } from '~/components/employer/rules-settings';
import { RequestCard } from '../src/app/(tabs)/(account)/employer/approvals';
import { dayRuns, isHiringNow, type CompanyHiring } from '~/features/companies/hiring';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { LRI, PDI } from '~/i18n/rich';
import { ThemeProvider } from '~/theme/provider';

jest.mock('~/lib/session', () => ({ useSession: () => ({ viewer: null, actor: null, session: null }) }));

/*
  A company says when it hires (Phase B 07a): the notice on a paused
  company's listing and page, its contact and reply hours, and the admin's
  settings; and its own account (07c): the owner's card, and the record a
  candidate keeps — right to left and at the largest text size.
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

describe('OwnershipSettings', () => {
  const team = [
    { userId: 'o', name: 'أحمد', role: 'admin' as const, isOwner: true, canPost: true, canReveal: true, canSpend: true },
    { userId: 'm', name: 'منى', role: 'recruiter' as const, isOwner: false, canPost: true, canReveal: true, canSpend: false },
  ];
  const owner = (closure: { deletionRequestedAt: string | null; closedAt: string | null; purgeAfterDays: 30 | 90 | 180 | 365 | null }) => (
    <Providers>
      <OwnershipSettings companyName="شركة النيل" team={team} isOwner closure={closure} />
    </Providers>
  );
  const open = owner({ deletionRequestedAt: null, closedAt: null, purgeAfterDays: 90 });

  it('offers the owner the purge period, handing over and deleting', () => {
    render(open);
    expect(screen.getByRole('radio', { name: ar.app.closure.purgeThreeMonths }).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByRole('button', { name: ar.app.closure.transfer })).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.app.closure.delete })).toBeTruthy();
  });

  it('says when a closing company goes, and offers to cancel instead of deleting again', () => {
    render(owner({ deletionRequestedAt: '2026-10-30T10:00:00Z', closedAt: null, purgeAfterDays: null }));
    expect(screen.getByText(ar.app.closure.closingTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.app.closure.cancel })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.app.closure.delete })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.app.closure.transfer })).toBeNull();
  });

  it('draws right to left', () => {
    expect(render(open).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(open).toJSON()).toMatchSnapshot();
  });
});

describe('RecordRow', () => {
  const row = (
    <Providers>
      <RecordRow
        first
        record={{
          id: 1,
          candidate_id: 'c',
          job_title_ar: 'مستشار عقاري',
          job_title_en: null,
          company_name_ar: 'شركة أُغلقت',
          company_name_en: null,
          applied_at: '2026-08-01T10:00:00Z',
          last_status: 'shortlisted',
          ended_at: '2026-10-01T10:00:00Z',
          reason: 'company_purged',
        }}
      />
    </Providers>
  );

  it('draws right to left', () => {
    expect(render(row).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(row).toJSON()).toMatchSnapshot();
  });
});

describe('RulesSettings and RequestCard', () => {
  const view = (
    <Providers>
      <RulesSettings
        rules={{ approveDecline: true, approvePayChange: false, spendCeilingMonthEgp: 5000, requireMfa: false, cvAdminsOnly: true, mfaSatisfied: true }}
      />
      <RequestCard
        canDecide
        request={{
          id: 'r1',
          company_id: 'c',
          kind: 'decline',
          subject_id: 'a1',
          payload: {},
          requested_by: 'm',
          status: 'pending',
          decided_by: null,
          decided_at: null,
          note: null,
          created_at: '2026-10-30T09:00:00Z',
          candidateName: 'سارة عادل',
          jobTitleAr: 'مستشار مبيعات',
          jobTitleEn: null,
          currentStatus: 'shortlisted',
        }}
      />
    </Providers>
  );

  it('opens on the stored rules', () => {
    render(view);
    expect(screen.getByTestId('rule-decline').props.value).toBe(true);
    expect(screen.getByTestId('rule-pay').props.value).toBe(false);
    expect(screen.getByLabelText(ar.app.rules.ceiling).props.value).toBe('5000');
  });

  it('draws right to left', () => {
    expect(render(view).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(view).toJSON()).toMatchSnapshot();
  });
});
