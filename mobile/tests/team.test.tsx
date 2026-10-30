import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityEntry } from '~/components/employer/activity-entry';
import { TeamSettings } from '~/components/employer/team-settings';
import type { CompanyActivityRow } from '@/lib/supabase/database.types';
import type { TeamMember } from '~/features/employer/company';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  The team's switches (Phase B 03): the line under a member saying what the
  company keeps them from, and the sheet an admin turns them in — right to
  left and at the largest text size. Sending them is company.test.tsx's.
*/

jest.mock('~/lib/session', () => ({ useSession: () => ({ viewer: null, actor: null, session: null }) }));

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

const members: TeamMember[] = [
  { userId: 'owner', name: 'أحمد سمير', role: 'admin', isOwner: true, canPost: true, canReveal: true, canSpend: true },
  { userId: 'mona', name: 'منى عادل', role: 'recruiter', isOwner: false, canPost: false, canReveal: true, canSpend: false },
];

const roster = (canManage: boolean) => (
  <Providers>
    <TeamSettings members={members} canManage={canManage} />
  </Providers>
);

describe('TeamSettings switches', () => {
  it('says what the company keeps a member from, and nothing for the owner', () => {
    render(roster(false));
    expect(screen.getByTestId('team-withheld-mona').props.children).toBe(`${ar.app.team.noPost} · ${ar.app.team.noSpend}`);
    expect(screen.queryByTestId('team-withheld-owner')).toBeNull();
    // A recruiter reads them; only an admin is offered the switches.
    expect(screen.queryByRole('button', { name: `${ar.app.team.permissions}: منى عادل` })).toBeNull();
  });

  it("offers an admin each member's switches, but not the owner's", async () => {
    render(roster(true));
    expect(screen.queryByRole('button', { name: `${ar.app.team.permissions}: أحمد سمير` })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: `${ar.app.team.permissions}: منى عادل` }));
    expect(await screen.findByText(ar.app.team.permissionsFor.replace('{name}', 'منى عادل'))).toBeTruthy();
    expect(screen.getByTestId('permission-post').props.value).toBe(false);
    expect(screen.getByTestId('permission-reveal').props.value).toBe(true);
    expect(screen.getByTestId('permission-spend').props.value).toBe(false);
    expect(screen.getByText(ar.app.team.permissionsFooter)).toBeTruthy();
  });

  it('draws right to left', () => {
    expect(render(roster(true)).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(roster(true)).toJSON()).toMatchSnapshot();
  });

  it('draws the switches sheet right to left and at the largest text size', async () => {
    const first = render(roster(true));
    fireEvent.press(screen.getByRole('button', { name: `${ar.app.team.permissions}: منى عادل` }));
    await screen.findByTestId('permission-post');
    expect(first.toJSON()).toMatchSnapshot();
    first.unmount();

    mockWindow.fontScale = 3.571;
    const large = render(roster(true));
    fireEvent.press(screen.getByRole('button', { name: `${ar.app.team.permissions}: منى عادل` }));
    await screen.findByTestId('permission-post');
    expect(large.toJSON()).toMatchSnapshot();
  });
});

describe('ActivityEntry', () => {
  const row: CompanyActivityRow = {
    id: 1,
    at: '2026-10-30T11:04:00Z',
    actor_id: 'mona',
    actor_name: 'منى عادل',
    kind: 'application_moved',
    job_id: 'j1',
    job_title_ar: 'مستشار مبيعات',
    job_title_en: 'Sales consultant',
    application_id: 'a1',
    candidate_name: 'سارة عادل',
    subject_user_id: null,
    subject_name: null,
    agent_id: null,
    agent_name: null,
    detail: { from: 'new', to: 'interview' },
  };
  const entry = (
    <Providers>
      <ActivityEntry row={row} />
    </Providers>
  );

  it('says what was done, about whom, by whom', () => {
    render(entry);
    expect(screen.getByText(ar.app.activity.applicationMoved.replace('{to}', ar.applicationStatus.interview))).toBeTruthy();
    expect(screen.getByText('سارة عادل · مستشار مبيعات')).toBeTruthy();
    expect(screen.getByText(/^منى عادل · /)).toBeTruthy();
  });

  it('draws right to left', () => {
    expect(render(entry).toJSON()).toMatchSnapshot();
  });

  it('draws at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(entry).toJSON()).toMatchSnapshot();
  });
});
