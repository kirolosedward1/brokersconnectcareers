import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { JobRow, ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as ListingsScreen from '../src/app/(tabs)/(admin)/admin/jobs/index';
import * as ListingScreen from '../src/app/(tabs)/(admin)/admin/jobs/[id]';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { company } from './fixtures';
import { fakeServer } from './server';

/*
  The listings half of the console in the app — the website's /admin/jobs in
  every one of its views, and one listing's review — as the real screens draw
  them against stand-ins for Supabase and the website: each view's exact
  query, the search, the company filter a link carries, the paging; and on
  the review, the applications counted per stage, the company's signals, the
  reporters' files a tap away, the feature lever through the website's own
  action, and the record with a note added to it.
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
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const JOB_ID = '5b0c7d1e-0000-4000-8000-000000000301';
const OTHER_USER = '8b7c7f1e-0000-4000-8000-000000000099';
const OTHER_COMPANY = '0f5e2a3e-0000-4000-8000-000000000002';
const NO_ID = '00000000-0000-0000-0000-000000000000';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString();

/** A row of the list, as the website's select shapes it. */
const row = {
  id: JOB_ID,
  title_ar: 'مستشار مبيعات',
  title_en: null,
  status: 'active',
  is_featured: true,
  expires_at: inAMonth,
  published_at: '2026-10-10T10:00:00Z',
  created_at: '2026-10-09T10:00:00Z',
  company: { id: company.id, name_ar: company.name_ar, name_en: null, verification_status: 'verified', suspended_at: null },
  applications: [{ count: 4 }],
};

/** The listing as its review reads it: live by the date, not featured. */
const job: JobRow & { company: object; district: object } = {
  id: JOB_ID,
  company_id: company.id,
  title_ar: 'مستشار مبيعات',
  title_en: null,
  slug: 'sales-a1b2',
  track: 'primary',
  employment_type: 'full_time',
  experience_band: 'junior_1_3',
  seats: 3,
  district_id: 1,
  basic_salary_min: 8000,
  basic_salary_max: 12000,
  commission_type: 'percentage',
  commission_value: 1.5,
  commission_note_ar: null,
  leads_source: 'company_provided',
  benefits: [],
  description_ar: 'بيع وحدات سكنية في التجمع.',
  description_en: null,
  requirements_ar: null,
  status: 'active',
  is_featured: false,
  featured_until: null,
  published_at: '2026-10-10T10:00:00Z',
  expires_at: inAMonth,
  view_count: 12,
  rejection_note: null,
  version: 4,
  idempotency_key: null,
  created_at: '2026-10-09T10:00:00Z',
  company: { id: company.id, name_ar: company.name_ar, name_en: null, slug: company.slug, verification_status: 'verified', suspended_at: null },
  district: { name_ar: 'التجمع الخامس', name_en: 'Fifth Settlement' },
};

const signals = {
  job_id: JOB_ID,
  flags: [],
  company_id: company.id,
  company_signals: {
    signals: [
      { signal: 'rejections', count: 2 },
      { signal: 'shared_phone', companies: [{ id: OTHER_COMPANY, name_ar: 'شركة تانية', name_en: null, suspended: true }] },
    ],
    facts: {},
  },
};

let me: ProfileRow;
let listing: typeof job;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  me = { ...adminProfile };
  listing = { ...job };
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  // The list (a page, with its total) or the one listing the review asked for.
  server.on('GET /rest/v1/jobs', (url: URL) =>
    url.searchParams.get('id')?.startsWith('eq.') ? [listing] : { body: [row], headers: { 'content-range': '0-0/1' } },
  );
  server.on('POST /rest/v1/rpc/admin_flagged_pending_jobs', () => [JOB_ID]);
  server.on('POST /rest/v1/rpc/admin_job_signals', () => [signals]);
  server.on('GET /rest/v1/job_moderation', []);
  server.on('GET /rest/v1/reports', [
    { id: 'r1', reason: 'scam', detail: 'طلبوا فلوس قبل المقابلة.', status: 'open', created_at: '2026-10-20T10:00:00Z', reporter: { id: OTHER_USER, full_name: 'منى علي' } },
  ]);
  // Five new, one hired, nothing at the other stages.
  server.on('HEAD /rest/v1/applications', (url: URL) => ({
    body: null,
    headers: { 'content-range': url.searchParams.get('status') === 'eq.new' ? '*/5' : url.searchParams.get('status') === 'eq.hired' ? '*/1' : '*/0' },
  }));
  server.on('GET /rest/v1/admin_audit_log', []);
  server.on('GET /rest/v1/moderation_notes', []);
  server.on('POST /api/mobile/v1/actions/setJobFeatured', { ok: true });
  server.on('POST /api/mobile/v1/actions/moderateJob', { ok: true });
  server.on('POST /api/mobile/v1/actions/addModerationNote', { ok: true });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  toast.hide();
});

/** An admin, signed in with their authenticator's code (aal2). */
async function signIn() {
  const user = authUser({ factors: [totpFactor] });
  server.on('POST /auth/v1/token', () => authSession(user, 'aal2'));
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: me.role, approval_status: me.approval_status }, company: null });
  server.requests.length = 0;
}

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
              <DecisionSheetHost />
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function stand(label: string) {
  function Screen() {
    return <Text>{label}</Text>;
  }
  return Screen;
}

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(home)/index': stand('home'),
  '(tabs)/(admin)/admin/index': stand('the overview'),
  '(tabs)/(admin)/admin/jobs/index': ListingsScreen,
  '(tabs)/(admin)/admin/jobs/[id]': ListingScreen,
  '(tabs)/(admin)/admin/companies/[id]': stand('a company'),
  '(tabs)/(admin)/admin/users/[id]': stand('an account'),
  '(tabs)/(admin)/admin/reports/index': stand('the reports'),
  '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/jobs/[slug]': stand('the public page'),
  mfa: stand('the code screen'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

/** What the list last asked the jobs table for: its query string, which is the whole request. */
function lastAsked() {
  return server.asked('/rest/v1/jobs').at(-1)!.url.searchParams;
}

/** The sheet's own confirm button: the last one with the lever's label, after the one on the screen that opened it. */
function confirmButton(label: string) {
  return screen.getAllByRole('button', { name: label }).at(-1)!;
}

const view = (name: keyof typeof ar.admin.jobView) => screen.getByRole('radio', { name: ar.admin.jobView[name] });

describe('the listings', () => {
  it('draws the review queue first, asking exactly what the website asks, with what each listing flags', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/jobs' });

    expect(await screen.findByText('مستشار مبيعات')).toBeTruthy();
    const asked = lastAsked();
    expect(asked.get('status')).toBe('eq.pending_review');
    expect(asked.get('order')).toBe('created_at.asc,id.asc');
    expect(asked.get('offset')).toBe('0');
    expect(asked.get('limit')).toBe('25');
    // (postgrest-js sends the select without its spaces.)
    expect(asked.get('select')).toBe(
      'id,title_ar,title_en,status,is_featured,expires_at,published_at,created_at,company:companies!inner(id,name_ar,name_en,verification_status,suspended_at),applications(count)',
    );
    expect(asked.has('company_id')).toBe(false);
    // The flags, read for the waiting views only, by the ids drawn.
    expect(server.asked('/rest/v1/rpc/admin_job_signals').at(-1)?.body).toEqual({ p_jobs: [JOB_ID] });
    // The website's columns: the company, how many applied, the status, and the featured mark.
    expect(screen.getByText(company.name_ar)).toBeTruthy();
    expect(screen.getByText(`${ar.admin.colApplicants}: 4`)).toBeTruthy();
    expect(screen.getByLabelText(ar.admin.featured)).toBeTruthy();
    expect(view('pending').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('runs each view as the website runs it', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/jobs' });
    await screen.findByText('مستشار مبيعات');

    fireEvent.press(view('live'));
    await waitFor(() => expect(lastAsked().get('order')).toBe('published_at.desc,id.asc'));
    expect(lastAsked().get('status')).toBe('eq.active');
    expect(lastAsked().get('expires_at')).toMatch(/^gt\.\d{4}-/);
    // Only the waiting views ask for flags.
    expect(server.asked('/rest/v1/rpc/admin_job_signals')).toHaveLength(1);

    fireEvent.press(view('expiring'));
    await waitFor(() => expect(lastAsked().get('order')).toBe('expires_at.asc,id.asc'));
    expect(lastAsked().getAll('expires_at').map((value) => value.split('.')[0])).toEqual(['gt', 'lte']);
    expect(screen.getByText(ar.admin.jobView.expiring)).toBeTruthy();

    fireEvent.press(view('quiet'));
    await waitFor(() => expect(lastAsked().get('applications')).toBe('is.null'));
    expect(lastAsked().get('select')).toContain('applications(id)');
    expect(lastAsked().get('published_at')).toMatch(/^lt\./);
    expect(lastAsked().get('order')).toBe('published_at.asc,id.asc');
    expect(screen.getByText(ar.admin.quietHint)).toBeTruthy();
    // An anti-join: nobody applied, by construction.
    expect(await screen.findByText(`${ar.admin.colApplicants}: 0`)).toBeTruthy();

    fireEvent.press(view('reported'));
    await waitFor(() => expect(lastAsked().get('open_reports.status')).toBe('in.(open,investigating)'));
    expect(lastAsked().get('select')).toContain('open_reports:reports!inner(id)');
    expect(lastAsked().get('order')).toBe('created_at.desc,id.asc');

    fireEvent.press(view('expired'));
    await waitFor(() => expect(lastAsked().get('or')).toMatch(/^\(status\.eq\.expired,and\(status\.eq\.active,expires_at\.lte\.\d{4}-.*\)\)$/));
    expect(lastAsked().get('order')).toBe('expires_at.desc,id.asc');

    fireEvent.press(view('closed'));
    await waitFor(() => expect(lastAsked().get('status')).toBe('eq.closed'));
    expect(lastAsked().get('order')).toBe('created_at.desc,id.asc');

    fireEvent.press(view('all'));
    await waitFor(() => expect(lastAsked().get('order')).toBe('created_at.desc,id.asc'));
    expect(lastAsked().has('status')).toBe(false);
  });

  it('narrows the flagged view to what the database flags, and to nothing when it flags nothing', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/jobs' });
    await screen.findByText('مستشار مبيعات');

    fireEvent.press(view('flagged'));
    await waitFor(() => expect(lastAsked().get('id')).toBe(`in.(${JOB_ID})`));
    expect(server.asked('/rest/v1/rpc/admin_flagged_pending_jobs').at(-1)?.body).toEqual({ p_limit: 500 });
    expect(lastAsked().get('status')).toBe('eq.pending_review');
    expect(lastAsked().get('order')).toBe('created_at.asc,id.asc');

    // An empty list still has to match nothing rather than everything.
    server.on('POST /rest/v1/rpc/admin_flagged_pending_jobs', () => []);
    fireEvent.press(view('all'));
    await waitFor(() => expect(lastAsked().has('status')).toBe(false));
    fireEvent.press(view('flagged'));
    await waitFor(() => expect(lastAsked().get('id')).toBe(`in.(${NO_ID})`));
  });

  it('searches an id as an id, and words over the titles and the slug with the loose Arabic pattern', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/jobs' });
    await screen.findByText('مستشار مبيعات');

    const field = screen.getByLabelText(ar.filters.search);
    expect(field.props.placeholder).toBe(ar.admin.jobsSearchPlaceholder);
    fireEvent.changeText(field, `  ${JOB_ID}  `);
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(lastAsked().get('id')).toBe(`eq.${JOB_ID}`));
    expect(lastAsked().has('or')).toBe(false);

    fireEvent.changeText(field, 'أحمد');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(lastAsked().get('or')).toBe('(title_ar.ilike.*_حمد*,title_en.ilike.*_حمد*,slug.ilike.*_حمد*)'));
    expect(lastAsked().has('id')).toBe(false);

    // A search that found nothing says so, never "nothing waiting".
    server.on('GET /rest/v1/jobs', () => ({ body: [], headers: { 'content-range': '*/0' } }));
    fireEvent.changeText(field, 'منى');
    fireEvent(field, 'submitEditing');
    expect(await screen.findByText(ar.admin.searchNothing)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();
  });

  it('opens the view and the company a website link names, and drops the company with its chip', async () => {
    await signIn();
    renderRouter(app, { initialUrl: `/admin/jobs?status=all&company=${company.id}` });

    expect(await screen.findByText('مستشار مبيعات')).toBeTruthy();
    expect(lastAsked().get('company_id')).toBe(`eq.${company.id}`);
    expect(lastAsked().has('status')).toBe(false);
    expect(view('all').props.accessibilityState).toMatchObject({ checked: true });

    fireEvent.press(screen.getByRole('button', { name: ar.app.admin.listings.oneCompany }));
    await waitFor(() => expect(lastAsked().has('company_id')).toBe(false));
  });

  it('ignores a view or a company a link names that the console does not have', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/jobs?status=nowhere&company=not-a-uuid' });

    expect(await screen.findByText('مستشار مبيعات')).toBeTruthy();
    expect(lastAsked().get('status')).toBe('eq.pending_review');
    expect(lastAsked().has('company_id')).toBe(false);
  });

  it('asks for the next twenty-five from where the last page ended, and stops at the total', async () => {
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ ...row, id: `00000000-0000-4000-8000-${String(offset + i).padStart(12, '0')}`, title_ar: `إعلان ${offset + i}` }));
    server.on('GET /rest/v1/jobs', (url: URL) => {
      const offset = Number(url.searchParams.get('offset'));
      return offset === 0
        ? { body: page(0, 25), headers: { 'content-range': '0-24/30' } }
        : { body: page(25, 5), headers: { 'content-range': '25-29/30' } };
    });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/jobs?status=live' });

    expect(await screen.findByText('إعلان 0')).toBeTruthy();
    expect(lastAsked().get('offset')).toBe('0');
    expect(lastAsked().get('limit')).toBe('25');

    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    await waitFor(() => expect(lastAsked().get('offset')).toBe('25'));
    expect(lastAsked().get('limit')).toBe('25');

    // Thirty of thirty: the end is the end.
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    expect(server.asked('/rest/v1/jobs')).toHaveLength(2);
  });

  it('says a failed read failed — never that nothing is waiting', async () => {
    server.on('GET /rest/v1/jobs', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/jobs' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();
  });
});

describe("a listing's review", () => {
  it('counts the applications per stage, weighs the company, and names the reporters', async () => {
    await signIn();
    const result = renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    expect(await screen.findByText(job.description_ar)).toBeTruthy();
    // Five head counts, one per stage, for this listing.
    const counted = server.requests.filter((request) => request.method === 'HEAD' && request.url.pathname === '/rest/v1/applications');
    expect(counted.map((request) => request.url.searchParams.get('status'))).toEqual(['eq.new', 'eq.shortlisted', 'eq.interview', 'eq.hired', 'eq.rejected']);
    expect(counted.every((request) => request.url.searchParams.get('job_id') === `eq.${JOB_ID}`)).toBe(true);
    expect(screen.getByText(ar.admin.applicationsCount.replace('{count}', '6'))).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    // Published, with a date, and so a public page.
    expect(screen.getByText(`${ar.jobStatus.active}`)).toBeTruthy();
    expect(screen.getByRole('link', { name: ar.admin.publicPage })).toBeTruthy();

    // The company's signals, worded as facts, with the companies they name a tap away.
    expect(screen.getByText(/اترفضت.*2/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`\\(${ar.admin.suspended}\\)`))).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: 'شركة تانية' }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/companies/${OTHER_COMPANY}`));
  });

  it("opens the reporter's file, and the company's page", async () => {
    await signIn();
    const result = renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    expect(await screen.findByText('طلبوا فلوس قبل المقابلة.')).toBeTruthy();
    // One open report, and the way to the queue.
    expect(screen.getByText('بلاغ واحد')).toBeTruthy();
    expect(screen.getByRole('link', { name: ar.admin.openReportsQueue })).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: 'منى علي' }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/users/${OTHER_USER}`));
  });

  it("opens the company's page, and all of its listings", async () => {
    await signIn();
    const result = renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    expect(await screen.findByText(job.description_ar)).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: ar.admin.allCompanyListings }));
    await waitFor(() => expect(result.getPathname()).toBe('/admin/jobs'));
    await waitFor(() => expect(lastAsked().get('company_id')).toBe(`eq.${company.id}`));
    expect(lastAsked().has('status')).toBe(false);
    expect(view('all').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('features a live listing through the website, and says so only once the website has', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/setJobFeatured', () => new Promise((resolve) => (answer = resolve)));
    await signIn();
    renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.feature }));
    expect(await screen.findByText(ar.admin.featureBody)).toBeTruthy();
    // No reason: recorded, nobody is told.
    expect(screen.queryByLabelText(ar.admin.reasonLabel)).toBeNull();
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.feature));
    });
    await waitFor(() => expect(actionsCalled('setJobFeatured')).toHaveLength(1));
    expect(actionsCalled('setJobFeatured')[0].body).toEqual({ input: { jobId: JOB_ID, featured: true } });
    expect(shownToast()).toBeNull();

    await act(async () => {
      answer({ ok: true });
    });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.feature}`));
  });

  it('offers to remove the feature from a featured listing, and no feature lever on one that is not live', async () => {
    listing = { ...job, is_featured: true };
    await signIn();
    renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.unfeature }));
    // The sheet, with only the confirmation: nothing to explain, nothing to ask.
    await screen.findByRole('button', { name: ar.common.cancel });
    expect(screen.queryByText(ar.admin.featureBody)).toBeNull();
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.unfeature));
    });
    await waitFor(() => expect(actionsCalled('setJobFeatured')[0]?.body).toEqual({ input: { jobId: JOB_ID, featured: false } }));
  });

  it('offers a listing waiting for review its three decisions and no feature lever', async () => {
    listing = { ...job, status: 'pending_review', published_at: null, expires_at: null };
    await signIn();
    renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    expect(await screen.findByRole('button', { name: `${ar.admin.approve}: مستشار مبيعات` })).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.admin.requestChanges })).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.admin.reject })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.feature })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.unpublish })).toBeNull();
  });

  it('keeps the record, and adds a note to it through the website', async () => {
    server.on('GET /rest/v1/admin_audit_log', [
      { id: 1, actor_id: USER_ID, actor_name: 'كيرلس', action: 'job.approve', target_type: 'job', target_id: JOB_ID, target_label: null, reason: null, metadata: {}, via: 'direct', created_at: '2026-10-10T10:00:00Z' },
    ]);
    await signIn();
    renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    expect(await screen.findByText(ar.admin.auditAction.job_approve, { exact: false })).toBeTruthy();
    expect(screen.getByText(ar.admin.viaDirect)).toBeTruthy();
    const asked = server.asked('/rest/v1/admin_audit_log').at(-1)!.url.searchParams;
    expect(asked.get('target_type')).toBe('eq.job');
    expect(asked.get('target_id')).toBe(`eq.${JOB_ID}`);

    fireEvent.press(screen.getByRole('button', { name: ar.app.admin.addNote }));
    fireEvent.changeText(await screen.findByLabelText(ar.app.admin.noteLabel), 'نتابع الشركة دي');
    await act(async () => {
      fireEvent.press(confirmButton(ar.app.admin.addNote));
    });
    await waitFor(() => expect(actionsCalled('addModerationNote')).toHaveLength(1));
    expect(actionsCalled('addModerationNote')[0].body).toEqual({ input: { targetType: 'job', targetId: JOB_ID, body: 'نتابع الشركة دي' } });
  });

  it('says a review that could not be read failed, rather than drawing a listing with nothing on it', async () => {
    server.on('POST /rest/v1/rpc/admin_job_signals', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(job.description_ar)).toBeNull();
  });
});
