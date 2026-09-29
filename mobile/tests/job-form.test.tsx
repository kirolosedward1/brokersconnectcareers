import type { ReactNode } from 'react';
import { Alert, Text, type AlertButton } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { ChipGroup } from '~/components/profile/fields';
import type { DistrictRow, JobRow, ProfileRow } from '@/lib/supabase/database.types';
import { decimalNumber, initialValues, MAX_DEVELOPERS, problemsOn, stepOf } from '~/features/employer/job-form';
import { useEmployerSummary } from '~/features/employer/overview';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as EditJobScreen from '../src/app/(tabs)/(listings)/employer/jobs/[id]/edit';
import * as NewJobScreen from '../src/app/(tabs)/(listings)/employer/jobs/new';
import { authSession, authUser, mobileConfig, ownedCompany, profile, USER_ID } from './auth-fixtures';
import { detail, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  Posting a listing and changing one, as the real wizard does it against
  stand-ins for Supabase and the website: each step checked before the next,
  the two questions asked on leaving the first, the advert previewed as it
  will be published, and exactly what saveJob is sent — and where the
  website's refusals send the employer back to.
*/

jest.mock('~/lib/session-storage', () => {
  const store = new Map<string, string>();
  return {
    encryptedSessionStorage: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
    },
  };
});

const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const user = authUser();
const employer: ProfileRow = { ...profile, role: 'employer' };
const zayed: DistrictRow = { id: 9, governorate_id: 2, name_ar: 'الشيخ زايد', name_en: 'Sheikh Zayed', slug: 'sheikh-zayed' };

// A listing already on the board, as the edit screen reads it.
const { company: _company, district: _district, job_developers: _developers, ...row } = detail;
const liveJob = { ...row, company_id: ownedCompany.id, status: 'active', version: 4 } as unknown as JobRow;

const warnings: string[] = [];
beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
  warnings.length = 0;
});

beforeEach(async () => {
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [employer]);
  server.on('POST /rest/v1/rpc/my_company_id', () => ownedCompany.id);
  server.on('GET /rest/v1/companies', [ownedCompany]);
  server.on('/rest/v1/districts', [newCairo, zayed]);
  server.on('/rest/v1/developers', [{ id: 3, name_ar: 'بالم هيلز', name_en: 'Palm Hills', slug: 'palm-hills' }]);
  server.on('GET /rest/v1/jobs', [liveJob]);
  server.on('GET /rest/v1/job_developers', [{ developer_id: 3 }]);
  server.on('POST /api/mobile/v1/actions/findSimilarListing', {
    ok: true,
    data: { match: { id: 'j-existing', title: 'مستشار مبيعات', seats: 2 } },
  });
  server.on('POST /api/mobile/v1/actions/salaryReferenceFor', { ok: true, data: { reference: { sample: 6, low: 8000, high: 14000 } } });
  server.on('POST /api/mobile/v1/actions/saveJob', { ok: true, data: { id: 'j-new' } });
  server.on('POST /rest/v1/rpc/employer_summary', { jobs_live: 1 });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({
    userId: USER_ID,
    profile: { role: 'employer', approval_status: 'approved' },
    company: { id: ownedCompany.id, verification_status: ownedCompany.verification_status },
  });
  server.requests.length = 0;
});

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

function Root() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Settled>
              <Stack screenOptions={{ headerShown: false }} />
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function Console() {
  // As the real console: its figures are read, and read again after every save.
  useEmployerSummary();
  return <Text>the console</Text>;
}

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(listings)/_layout': { default: () => <Stack />, unstable_settings: { anchor: 'employer/jobs/index' } },
  '(tabs)/(listings)/employer/jobs/index': Console,
  '(tabs)/(listings)/employer/jobs/new': NewJobScreen,
  '(tabs)/(listings)/employer/jobs/[id]/edit': EditJobScreen,
};

const saved = () => server.asked('/api/mobile/v1/actions/saveJob').map((request) => (request.body as { input: Record<string, unknown> }).input);
const next = () => fireEvent.press(screen.getByRole('button', { name: ar.jobForm.next }));
const DESCRIPTION = 'بيع وحدات سكنية في مشروعات القاهرة الجديدة لعملاء الشركة.';

describe('a new listing', () => {
  it('walks the four steps, asks its two questions on the way, and submits what was filled in', async () => {
    const result = renderRouter(app, { initialUrl: '/employer/jobs/new' });

    // The first district is chosen for a new listing, as on the website.
    expect(await screen.findByLabelText(`${ar.jobForm.district}: ${newCairo.name_ar}`)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.jobForm.titleAr), 'مستشار مبيعات');
    next();

    // Asked on leaving the first step, answered on the second.
    expect(await screen.findByText(ar.employer.duplicateTitle)).toBeTruthy();
    expect(await screen.findByText(/^الأساسي في الإعلانات الشبيهة بين/)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/findSimilarListing')[0]?.body).toEqual({
      input: { titleAr: 'مستشار مبيعات', districtId: newCairo.id, excludeId: null },
    });
    fireEvent.press(screen.getByRole('button', { name: ar.employer.duplicateDismiss }));

    // A percentage commission needs its figure — typed with Arabic digits and mark.
    next();
    expect(await screen.findByText(ar.validation.commissionRequired)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.jobForm.commissionValue), '٢٫٥');
    fireEvent.changeText(screen.getByLabelText(ar.jobForm.basicSalaryMin), '٨٠٠٠');
    next();

    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.descriptionAr), 'قصير');
    next();
    expect(await screen.findByText(ar.validation.required)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.jobForm.descriptionAr), DESCRIPTION);
    fireEvent.press(screen.getByRole('button', { name: 'بالم هيلز' }));
    next();

    // The advert as it will be published.
    expect(await screen.findByText(ar.jobForm.reviewNote)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.employer.saveDraft })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.employer.submitForReview }));

    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toEqual({
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      titleAr: 'مستشار مبيعات',
      titleEn: null,
      track: 'primary',
      employmentType: 'full_time',
      experienceBand: 'junior_1_3',
      seats: 1,
      districtId: newCairo.id,
      basicSalaryMin: 8000,
      basicSalaryMax: null,
      commissionType: 'percentage',
      commissionValue: 2.5,
      commissionNoteAr: null,
      leadsSource: 'company_provided',
      benefits: [],
      descriptionAr: DESCRIPTION,
      descriptionEn: null,
      requirementsAr: null,
      developerIds: [3],
      submit: true,
    });
    await waitFor(() => expect(result.getPathname()).toBe('/employer/jobs'));
  });

  it('saves a draft as it stands, and repeats the same key when the save is tried again', async () => {
    server.on('POST /api/mobile/v1/actions/saveJob', { ok: false, error: 'failed' });
    renderRouter(app, { initialUrl: '/employer/jobs/new' });
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.titleAr), 'مستشار مبيعات');
    next();
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.commissionValue), '2');
    next();
    next(); // Nothing on the details step yet: the review step is still reachable by its tab.
    fireEvent.press(await screen.findByRole('button', { name: ar.jobForm.review }));
    fireEvent.press(await screen.findByRole('button', { name: ar.employer.saveDraft }));
    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.employer.saveDraft }));

    await waitFor(() => expect(saved()).toHaveLength(2));
    expect(saved()[0].submit).toBe(false);
    expect(saved()[1].idempotencyKey).toBe(saved()[0].idempotencyKey);
  });

  it("sends the employer back to the step that holds the website's objection", async () => {
    server.on('POST /api/mobile/v1/actions/saveJob', { ok: false, error: 'invalid', fieldErrors: { descriptionAr: 'tooManyLinks' } });
    renderRouter(app, { initialUrl: '/employer/jobs/new' });
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.titleAr), 'مستشار مبيعات');
    next();
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.commissionValue), '2');
    next();
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.descriptionAr), DESCRIPTION);
    next();
    fireEvent.press(await screen.findByRole('button', { name: ar.employer.submitForReview }));

    expect(await screen.findByText(ar.validation.tooManyLinks)).toBeTruthy();
    expect(screen.getByLabelText(ar.jobForm.descriptionAr)).toBeTruthy();
  });

  it('goes back to the title when the database refuses a third copy', async () => {
    server.on('POST /api/mobile/v1/actions/saveJob', { ok: false, error: 'duplicate_listing' });
    renderRouter(app, { initialUrl: '/employer/jobs/new' });
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.titleAr), 'مستشار مبيعات');
    next();
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.commissionValue), '2');
    next();
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.descriptionAr), DESCRIPTION);
    next();
    fireEvent.press(await screen.findByRole('button', { name: ar.employer.submitForReview }));

    expect(await screen.findByText(ar.employer.duplicateListingBlocked)).toBeTruthy();
    expect(screen.getByLabelText(ar.jobForm.titleAr)).toBeTruthy();
  });
});

describe('leaving the wizard', () => {
  it('asks before a half-written listing is thrown away, and goes when told to', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const result = renderRouter(app, { initialUrl: '/employer/jobs' });
    act(() => router.push('/employer/jobs/new'));
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.titleAr), 'مستشار مبيعات');

    act(() => router.back());
    expect(alert).toHaveBeenCalledWith(ar.app.leave.title, ar.app.leave.body, expect.any(Array));
    expect(result.getPathname()).toBe('/employer/jobs/new');

    const leave = (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.style === 'destructive');
    act(() => leave?.onPress?.());
    await waitFor(() => expect(result.getPathname()).toBe('/employer/jobs'));
    alert.mockRestore();
  });
});

describe('a listing on the board', () => {
  it('is edited, not submitted: the version it was built from goes with it, and there is no draft', async () => {
    const result = renderRouter(app, { initialUrl: `/employer/jobs/${liveJob.id}/edit` });

    expect((await screen.findByLabelText(ar.jobForm.titleAr)).props.value).toBe(liveJob.title_ar);
    fireEvent.press(screen.getByRole('button', { name: ar.jobForm.review }));
    expect(await screen.findByText(ar.jobForm.liveEditNote)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.employer.saveDraft }) === null).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: ar.employer.saveChanges }));

    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({ id: liveJob.id, version: 4, submit: true, developerIds: [3], seats: liveJob.seats });
    await waitFor(() => expect(result.getPathname()).toBe('/employer/jobs'));
  });

  it('closes once saved, without waiting for every employer figure to be read again', async () => {
    let saves = 0;
    // Read again after the save, the listing comes back at its new version.
    server.on('GET /rest/v1/jobs', () => [{ ...liveJob, version: saves ? 5 : 4 }]);
    server.on('POST /rest/v1/rpc/employer_summary', { jobs_live: 1 });
    server.on('POST /api/mobile/v1/actions/saveJob', () => {
      saves += 1;
      return { ok: true, data: { id: liveJob.id } };
    });
    // The console's figures take their time after the save, as a slow answer does.
    let letGo: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const plain = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/rpc/employer_summary') && saves) await held;
      return plain(input, init);
    }) as typeof fetch;

    try {
      const result = renderRouter(app, { initialUrl: `/employer/jobs/${liveJob.id}/edit` });
      fireEvent.press(await screen.findByRole('button', { name: ar.jobForm.review }));
      fireEvent.press(await screen.findByRole('button', { name: ar.employer.saveChanges }));

      await waitFor(() => expect(saves).toBe(1));
      await waitFor(() => expect(result.getPathname()).toBe('/employer/jobs'));
      expect(screen.queryByLabelText(ar.jobForm.titleAr)).toBeNull();
    } finally {
      letGo();
      globalThis.fetch = plain;
    }
  });

  it("says so when a colleague saved it first, rather than overwriting their work", async () => {
    let theirs = false;
    // A colleague's save lands first, with a title of their own.
    server.on('GET /rest/v1/jobs', () => [theirs ? { ...liveJob, version: 5, title_ar: 'مستشار مبيعات أول' } : liveJob]);
    server.on('POST /api/mobile/v1/actions/saveJob', () => {
      theirs = true;
      return { ok: false, error: 'stale' };
    });
    renderRouter(app, { initialUrl: `/employer/jobs/${liveJob.id}/edit` });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobForm.review }));
    fireEvent.press(await screen.findByRole('button', { name: ar.employer.saveChanges }));
    expect(await screen.findByText(ar.employer.listingMoved)).toBeTruthy();
  });

  it('takes an edit whose answer was lost for saved when the listing says what it sent', async () => {
    let stored = liveJob;
    server.on('GET /rest/v1/jobs', () => [stored]);
    // The website saves the edit, and its answer never reaches the phone.
    server.on('POST /api/mobile/v1/actions/saveJob', (_url: URL, init?: RequestInit) => {
      const { input } = JSON.parse(String(init?.body)) as { input: { titleAr: string } };
      // Stored as the website stores a title: its spaces collapsed.
      stored = { ...liveJob, version: 5, title_ar: input.titleAr.replace(/\s+/g, ' ').trim() };
      throw new TypeError('Network request failed');
    });
    const result = renderRouter(app, { initialUrl: `/employer/jobs/${liveJob.id}/edit` });
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.titleAr), 'مستشار مبيعات  للمشروعات ');
    fireEvent.press(screen.getByRole('button', { name: ar.jobForm.review }));
    fireEvent.press(await screen.findByRole('button', { name: ar.employer.saveChanges }));

    // Read back, it holds this edit: saved, once, and the wizard closes.
    await waitFor(() => expect(result.getPathname()).toBe('/employer/jobs'));
    expect(saved()).toHaveLength(1);
  });

  it('takes a refusal as stale for saved when it was this edit, sent again after its answer was lost', async () => {
    let stored = liveJob;
    server.on('GET /rest/v1/jobs', () => [stored]);
    server.on('POST /api/mobile/v1/actions/saveJob', (_url: URL, init?: RequestInit) => {
      const { input } = JSON.parse(String(init?.body)) as { input: { titleAr: string } };
      // The first went in; this one found the version it was built from gone.
      stored = { ...liveJob, version: 5, title_ar: input.titleAr };
      return { ok: false, error: 'stale' };
    });
    const result = renderRouter(app, { initialUrl: `/employer/jobs/${liveJob.id}/edit` });
    fireEvent.changeText(await screen.findByLabelText(ar.jobForm.titleAr), 'مستشار مبيعات للمشروعات');
    fireEvent.press(screen.getByRole('button', { name: ar.jobForm.review }));
    fireEvent.press(await screen.findByRole('button', { name: ar.employer.saveChanges }));
    await waitFor(() => expect(result.getPathname()).toBe('/employer/jobs'));
    expect(screen.queryByText(ar.employer.listingMoved)).toBeNull();
  });

  it("is not found when it is not the company's", async () => {
    server.on('GET /rest/v1/jobs', []);
    renderRouter(app, { initialUrl: '/employer/jobs/5b0c7d1e-0000-4000-8000-000000000999/edit' });
    expect(await screen.findByText(ar.common.notFound)).toBeTruthy();
  });
});

describe('the rules each step keeps', () => {
  const values = initialValues(null, [], newCairo.id);

  it('reads numbers typed with either set of digits and either decimal mark', () => {
    expect(decimalNumber('٢٫٥')).toBe(2.5);
    expect(decimalNumber('2,75')).toBe(2.75);
    expect(decimalNumber('')).toBeNull();
    expect(decimalNumber('2.5%')).toBeNaN();
  });

  it('asks for a title, a seat count and a district first', () => {
    expect(problemsOn(0, { ...values, titleAr: 'مس', seats: '0' })).toEqual({ titleAr: 'required', seats: 'required' });
    expect(problemsOn(0, { ...values, titleAr: 'مستشار', seats: '٣' })).toEqual({});
  });

  it('keeps the salary ceiling above the floor, and a percentage with its figure', () => {
    expect(problemsOn(1, { ...values, basicSalaryMin: '9000', basicSalaryMax: '8000', commissionValue: '2' })).toEqual({
      basicSalaryMax: 'salaryOrder',
    });
    expect(problemsOn(1, { ...values, commissionValue: '' })).toEqual({ commissionValue: 'commissionRequired' });
    expect(problemsOn(1, { ...values, commissionType: 'split', commissionValue: '' })).toEqual({});
  });

  it('sends a refusal back to the earliest step it names', () => {
    expect(stepOf(['descriptionAr', 'basicSalaryMax'])).toBe(1);
    expect(stepOf(['form'])).toBeNull();
  });
});

describe('a list with a limit', () => {
  it('takes no more than the website does, and says so, rather than being refused in silence', () => {
    const options = Array.from({ length: MAX_DEVELOPERS + 1 }, (_, index) => ({ value: index + 1, label: `مطور ${index + 1}` }));
    const chosen = options.slice(0, MAX_DEVELOPERS).map((option) => option.value);
    const toggled: number[] = [];
    render(
      <ThemeProvider>
        <I18nProvider>
          <ChipGroup legend="المطورين" options={options} selected={chosen} onToggle={(value) => toggled.push(value)} max={MAX_DEVELOPERS} />
        </I18nProvider>
      </ThemeProvider>,
    );

    const last = screen.getByRole('button', { name: `مطور ${MAX_DEVELOPERS + 1}` });
    expect(last.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(last);
    expect(toggled).toEqual([]);
    // One already chosen can still be let go.
    fireEvent.press(screen.getByRole('button', { name: 'مطور 1' }));
    expect(toggled).toEqual([1]);
    // The limit is said under the list.
    expect(screen.getByText(new RegExp(`^${ar.app.profile.chooseUpTo.split('<v>')[0]}`))).toBeTruthy();
  });
});
