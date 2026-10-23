import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { DeveloperRow, DistrictRow, GovernorateRow, ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as TaxonomyScreen from '../src/app/(tabs)/(admin)/admin/taxonomy/index';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The taxonomy in the app — the website's /admin/taxonomy — as the real
  screen draws it against stand-ins for Supabase and the website: the three
  tables in the website's order with their use counts, the fixed lists
  read-only, and the levers through the website's own actions with exactly
  the input the website sends: an entry added (id null, the slug typed once),
  renamed (the slug never sent), and deleted only while nothing uses it —
  "done" only once the website answered ok, a refusal kept in the sheet in
  the website's sentence.
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

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const cairo: GovernorateRow = { id: 1, name_ar: 'القاهرة', name_en: 'Cairo', slug: 'cairo' };
const giza: GovernorateRow = { id: 2, name_ar: 'الجيزة', name_en: 'Giza', slug: 'giza' };
const newCairo: DistrictRow = { id: 1, governorate_id: 1, name_ar: 'التجمع الخامس', name_en: 'Fifth Settlement', slug: 'new-cairo' };
const october: DistrictRow = { id: 2, governorate_id: 2, name_ar: '٦ أكتوبر', name_en: '6th of October', slug: 'october' };
const emaar: DeveloperRow = { id: 5, name_ar: 'إعمار', name_en: 'Emaar', slug: 'emaar' };

/** The sheet's own confirm button: the last one with the lever's label. */
function confirmButton(label: string) {
  return screen.getAllByRole('button', { name: label }).at(-1)!;
}

/** The form closes, and the decision sheet opens once it has gone: longer than a test's usual patience. */
const SHEET = { timeout: 4000 };

let me: ProfileRow;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  me = { ...adminProfile };
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('GET /rest/v1/districts', () => [newCairo, october]);
  server.on('GET /rest/v1/governorates', () => [cairo, giza]);
  server.on('GET /rest/v1/developers', () => [emaar]);
  server.on('POST /rest/v1/rpc/admin_taxonomy_usage', (url: URL, init: RequestInit | undefined) => {
    const kind = JSON.parse(String(init?.body)).p_kind as string;
    return kind === 'district' ? [{ id: 1, uses: 3 }, { id: 2, uses: 0 }] : kind === 'developer' ? [{ id: 5, uses: 0 }] : [{ id: 1, uses: 2 }, { id: 2, uses: 1 }];
  });
  server.on('POST /api/mobile/v1/actions/saveTaxonomy', { ok: true, data: { id: 9 } });
  server.on('POST /api/mobile/v1/actions/deleteTaxonomy', { ok: true });

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
  '(tabs)/(admin)/admin/taxonomy/index': TaxonomyScreen,
  mfa: stand('the code screen'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

/** What a table was last asked for: the query as PostgREST receives it. */
function lastRead(table: string) {
  const url = server.asked(`/rest/v1/${table}`).at(-1)?.url;
  return url ? Object.fromEntries(url.searchParams.entries()) : undefined;
}

describe('the taxonomy', () => {
  it('draws the districts first, by id, with their governorates and how much uses each', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/taxonomy' });

    expect(await screen.findByText('التجمع الخامس')).toBeTruthy();
    expect(lastRead('districts')).toEqual({ select: '*', order: 'id.asc' });
    expect(server.asked('/rest/v1/rpc/admin_taxonomy_usage')[0].body).toEqual({ p_kind: 'district' });
    expect(lastRead('governorates')).toEqual({ select: 'id,name_ar,name_en', order: 'id.asc' });

    expect(screen.getByText('new-cairo')).toBeTruthy();
    expect(screen.getByText(`${ar.admin.governorate}: القاهرة`)).toBeTruthy();
    expect(screen.getByText(ar.admin.entriesCount.replace('{count}', '2'))).toBeTruthy();
    // In use: the count, and no delete. Unused: the delete.
    expect(screen.getByText(/3 مرات/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: `${ar.admin.deleteEntry}: التجمع الخامس` })).toBeNull();
    expect(screen.getByRole('button', { name: `${ar.admin.deleteEntry}: ٦ أكتوبر` })).toBeTruthy();
  });

  it('reads developers by their English name, without the governorates, and opens the tab a link names', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/taxonomy?kind=developer' });

    expect(await screen.findByText('إعمار')).toBeTruthy();
    expect(lastRead('developers')).toEqual({ select: '*', order: 'name_en.asc' });
    expect(server.asked('/rest/v1/rpc/admin_taxonomy_usage')[0].body).toEqual({ p_kind: 'developer' });
    expect(server.asked('/rest/v1/governorates')).toHaveLength(0);
    expect(screen.getByRole('radio', { name: ar.admin.taxonomyTab.developer }).props.accessibilityState).toMatchObject({ checked: true });

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.taxonomyTab.governorate }));
    expect(await screen.findByText('الجيزة')).toBeTruthy();
    expect(server.asked('/rest/v1/rpc/admin_taxonomy_usage').at(-1)?.body).toEqual({ p_kind: 'governorate' });
  });

  it('shows the fixed lists read-only, and says why', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/taxonomy' });

    fireEvent.press(await screen.findByRole('radio', { name: ar.admin.taxonomyTab.fixed }));
    expect(await screen.findByText(ar.admin.fixedListsHint)).toBeTruthy();
    expect(screen.getByText(ar.track.primary)).toBeTruthy();
    expect(screen.getByText('primary')).toBeTruthy();
    expect(screen.getByText(ar.experienceBand.senior_5_plus)).toBeTruthy();
    expect(screen.getByText(ar.employmentType.full_time)).toBeTruthy();
    expect(screen.getByText(ar.companyType.brokerage)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.addEntry })).toBeNull();
    expect(screen.queryByText(ar.admin.deleteEntry)).toBeNull();
  });

  it('adds an entry through the website with id null, the slug lowercased, and its governorate', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/taxonomy' });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.addEntry }));
    expect(await screen.findByText(ar.app.admin.taxonomy.newEntry)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.admin.nameAr), ' الشيخ زايد ');
    fireEvent.changeText(screen.getByLabelText(ar.admin.nameEn), 'Sheikh Zayed');
    fireEvent.changeText(screen.getByLabelText(ar.admin.colSlug), 'Sheikh-Zayed');
    // The governorate, chosen from the website's list.
    fireEvent.press(screen.getByRole('button', { name: `${ar.admin.governorate}: القاهرة` }));
    fireEvent.press(await screen.findByRole('radio', { name: 'الجيزة' }));
    fireEvent.press(confirmButton(ar.admin.addEntry));

    // The form has gone; the sheet says what will happen, and nothing is sent until it is confirmed.
    expect(await screen.findByText(ar.app.admin.taxonomy.addBody.replace('{name}', 'الشيخ زايد'), {}, SHEET)).toBeTruthy();
    expect(actionsCalled('saveTaxonomy')).toHaveLength(0);
    expect(screen.queryByLabelText(ar.admin.colSlug)).toBeNull();
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.addEntry));
    });
    await waitFor(() => expect(actionsCalled('saveTaxonomy')).toHaveLength(1));
    expect(actionsCalled('saveTaxonomy')[0].body).toEqual({
      input: { kind: 'district', id: null, nameAr: 'الشيخ زايد', nameEn: 'Sheikh Zayed', slug: 'sheikh-zayed', governorateId: 2 },
    });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.app.admin.taxonomy.addTitle.replace('{name}', 'الشيخ زايد')}`));
  });

  it("applies the website's checks in the form, in its sentences, before anything is sent", async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/taxonomy?kind=developer' });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.addEntry }));
    await screen.findByText(ar.app.admin.taxonomy.newEntry);
    fireEvent.press(confirmButton(ar.admin.addEntry));
    expect(await screen.findByText(ar.admin.errors.invalid_name)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText(ar.admin.nameAr), 'سوديك');
    fireEvent.changeText(screen.getByLabelText(ar.admin.nameEn), 'SODIC');
    fireEvent.changeText(screen.getByLabelText(ar.admin.colSlug), 'so dic');
    fireEvent.press(confirmButton(ar.admin.addEntry));
    expect(await screen.findByText(ar.admin.errors.invalid_slug)).toBeTruthy();
    expect(actionsCalled('saveTaxonomy')).toHaveLength(0);

    // A developer has no governorate: none is sent.
    fireEvent.changeText(screen.getByLabelText(ar.admin.colSlug), 'sodic');
    fireEvent.press(confirmButton(ar.admin.addEntry));
    await screen.findByText(ar.app.admin.taxonomy.addBody.replace('{name}', 'سوديك'), {}, SHEET);
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.addEntry));
    });
    await waitFor(() => expect(actionsCalled('saveTaxonomy')).toHaveLength(1));
    expect(actionsCalled('saveTaxonomy')[0].body).toEqual({
      input: { kind: 'developer', id: null, nameAr: 'سوديك', nameEn: 'SODIC', slug: 'sodic', governorateId: null },
    });
  });

  it('renames an entry without ever sending its slug, and keeps a refused slug in the sheet in the website\'s words', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/taxonomy' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.app.admin.taxonomy.edit}: التجمع الخامس` }));
    expect(await screen.findByText(ar.app.admin.taxonomy.renameTitle.replace('{name}', 'التجمع الخامس'))).toBeTruthy();
    // The slug is shown, and is no field: it is permanent.
    expect(screen.queryByLabelText(ar.admin.colSlug)).toBeNull();
    expect(screen.getAllByText('new-cairo').length).toBeGreaterThan(1);
    expect(screen.getByText(ar.admin.slugPermanent)).toBeTruthy();
    // Nothing changed yet: nothing to save.
    expect(confirmButton(ar.admin.rename).props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText(ar.admin.nameEn), 'New Cairo');
    fireEvent.press(confirmButton(ar.admin.rename));
    expect(await screen.findByText(ar.app.admin.taxonomy.renameBody, {}, SHEET)).toBeTruthy();

    server.on('POST /api/mobile/v1/actions/saveTaxonomy', { ok: false, error: 'slug_taken' });
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.rename));
    });
    await waitFor(() => expect(actionsCalled('saveTaxonomy')).toHaveLength(1));
    expect(actionsCalled('saveTaxonomy')[0].body).toEqual({
      input: { kind: 'district', id: 1, nameAr: 'التجمع الخامس', nameEn: 'New Cairo', governorateId: 1 },
    });
    expect(await screen.findByText(ar.admin.errors.slug_taken)).toBeTruthy();
    expect(screen.getByText(ar.app.admin.taxonomy.renameBody)).toBeTruthy();
    expect(shownToast()).toBeNull();
  });

  it('deletes an unused entry through the website after a confirmation, and says so only once the website has', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/deleteTaxonomy', () => new Promise((resolve) => (answer = resolve)));
    await signIn();
    renderRouter(app, { initialUrl: '/admin/taxonomy' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.deleteEntry}: ٦ أكتوبر` }));
    expect(await screen.findByText(ar.admin.deleteEntryTitle.replace('{name}', '٦ أكتوبر'))).toBeTruthy();
    expect(screen.getByText(ar.admin.deleteEntryBody)).toBeTruthy();
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.deleteEntry));
    });
    await waitFor(() => expect(actionsCalled('deleteTaxonomy')).toHaveLength(1));
    expect(actionsCalled('deleteTaxonomy')[0].body).toEqual({ input: { kind: 'district', id: 2 } });
    expect(shownToast()).toBeNull();

    await act(async () => {
      answer({ ok: true });
    });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.deleteEntryTitle.replace('{name}', '٦ أكتوبر')}`));
  });

  it('says a list that could not be read failed — never that it is empty', async () => {
    server.on('GET /rest/v1/districts', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/taxonomy' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.app.admin.taxonomy.empty)).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.addEntry })).toBeNull();

    server.on('GET /rest/v1/districts', () => [newCairo, october]);
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText('التجمع الخامس')).toBeTruthy();
  });
});
