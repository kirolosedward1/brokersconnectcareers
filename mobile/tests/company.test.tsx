import type { ReactNode } from 'react';
import { ActionSheetIOS, Alert, RefreshControl, type AlertButton } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { CompanyDocumentRow, CompanyRow, OrderRow, ProfileRow } from '@/lib/supabase/database.types';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as BillingScreen from '../src/app/(tabs)/(account)/employer/billing';
import * as CompanyScreen from '../src/app/(tabs)/(account)/employer/company';
import { authSession, authUser, mobileConfig, ownedCompany, profile, USER_ID } from './auth-fixtures';
import { newCairo } from './fixtures';
import { phoneFormData, sentBody } from './multipart';
import { fakeServer } from './server';

/*
  The company's own pages on the phone — the profile, the logo, the
  verification papers, the team, and the balance — as the real screens draw
  them against stand-ins for Supabase and the website: what each is sent,
  what is offered to whom, and the website's words for each refusal.
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
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('expo-image-manipulator', () => {
  type MockContext = { resize: () => MockContext; renderAsync: () => Promise<{ saveAsync: () => Promise<{ uri: string }> }> };
  const context: MockContext = {
    resize: jest.fn(() => context),
    renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file:///cache/logo.png' }) }),
  };
  return { ImageManipulator: { manipulate: jest.fn(() => context) }, SaveFormat: { JPEG: 'jpeg', PNG: 'png' } };
});
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  // As expo-file-system's File: a name, a type from the extension, and its own bytes.
  File: jest.fn().mockImplementation((...parts: string[]) => {
    const name = parts.join('/').split('/').at(-1) ?? '';
    return {
      name,
      type: name.endsWith('.png') ? 'image/png' : '',
      size: 120_000,
      arrayBuffer: async () => new ArrayBuffer(4096),
      bytes: async () => new TextEncoder().encode(`the bytes of ${name}`),
    };
  }),
}));


const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const user = authUser();
const RECRUITER = 'c0000000-0000-4000-8000-000000000002';
const employer: ProfileRow = { ...profile, role: 'employer', full_name: 'أحمد سمير' };
const baseCompany: CompanyRow = { ...ownedCompany, verification_status: 'unverified', version: 3 };

let company: CompanyRow | null;
/** The chooser's answer for a paper: 0 camera, 1 photo library, 2 a file, 3 cancel. */
let paperFrom = 2;
let role: 'admin' | 'recruiter';
let documents: CompanyDocumentRow[];

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  globalThis.FormData = phoneFormData();
});

beforeEach(async () => {
  company = { ...baseCompany };
  role = 'admin';
  documents = [
    {
      id: 'd1',
      company_id: baseCompany.id,
      doc_type: 'commercial_register',
      storage_path: `${baseCompany.id}/commercial_register-1.pdf`,
      status: 'rejected',
      review_note: 'الصورة مش واضحة.',
      reviewed_by: null,
      reviewed_at: null,
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-21T10:00:00Z',
    } as CompanyDocumentRow,
  ];
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockReset();
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset();
  // Where a paper comes from, as the phone's own chooser answers: a file, unless a case says otherwise.
  paperFrom = 2;
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_options, choose) => choose(paperFrom));

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [employer]);
  server.on('POST /rest/v1/rpc/my_company_id', () => company?.id ?? null);
  server.on('GET /rest/v1/companies', () => (company ? [company] : []));
  server.on('/rest/v1/districts', [newCairo]);
  server.on('GET /rest/v1/company_documents', () => documents);
  server.on('GET /rest/v1/company_members', () => [
    { user_id: USER_ID, role, created_at: '2026-09-01T10:00:00Z', profile: { full_name: 'أحمد سمير' } },
    { user_id: RECRUITER, role: 'recruiter', created_at: '2026-09-02T10:00:00Z', profile: null },
  ]);
  server.on('POST /api/mobile/v1/actions/saveCompany', { ok: true, data: { id: baseCompany.id } });
  server.on('POST /api/mobile/v1/actions/uploadImage', { ok: true, data: { url: 'https://example/logo.webp' } });
  server.on('POST /api/mobile/v1/actions/saveCompanyLogo', { ok: true });
  server.on('POST /storage/v1/object/company-documents/*', { Id: 'o1', Key: 'company-documents/x' });
  server.on('DELETE /storage/v1/object/company-documents', []);
  server.on('POST /api/mobile/v1/actions/recordCompanyDocument', { ok: true });
  server.on('POST /api/mobile/v1/actions/addCompanyMember', { ok: true });
  server.on('POST /api/mobile/v1/actions/removeCompanyMember', { ok: true });
  server.on('GET /rest/v1/orders', [] as OrderRow[]);
  server.on('GET /rest/v1/monthly_free_post_grants', []);
  server.on('POST /api/mobile/v1/actions/claimMonthlyFreePost', { ok: true, data: { claimed: true } });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: 'employer', approval_status: 'approved' }, company: null });
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

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(account)/employer/company': CompanyScreen,
  '(tabs)/(account)/employer/billing': BillingScreen,
};

const input = (path: string, index = 0) => (server.asked(path)[index]?.body as { input: Record<string, unknown> } | undefined)?.input;

function answerAlert(alert: jest.SpyInstance, label: string) {
  const buttons = (alert.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  act(() => buttons.find((button) => button.text === label)?.onPress?.());
}

describe("the company's page, for a company admin", () => {
  it('offers the logo, the profile, the papers and the team', async () => {
    renderRouter(app, { initialUrl: '/employer/company' });

    expect(await screen.findByRole('button', { name: ar.employer.logoUpload })).toBeTruthy();
    expect(screen.getByLabelText(ar.companies.nameAr).props.value).toBe(baseCompany.name_ar);
    expect(await screen.findByText(ar.employer.verification)).toBeTruthy();
    expect(screen.getByText(ar.employer.docRejected)).toBeTruthy();
    expect(screen.getByText('الصورة مش واضحة.')).toBeTruthy();
    // The owner is marked and never removable; the recruiter, whose name is private, can be.
    expect(screen.getByText(ar.employer.teamOwner)).toBeTruthy();
    expect(screen.getByRole('button', { name: `${ar.employer.teamRemove}: —` })).toBeTruthy();
    expect(screen.getByLabelText(ar.employer.teamEmail)).toBeTruthy();
  });

  it('saves on the version it loaded, adds the scheme to a bare address, and says when a colleague saved first', async () => {
    renderRouter(app, { initialUrl: '/employer/company' });
    fireEvent.changeText(await screen.findByLabelText(ar.companies.website), 'nile.example');
    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));

    await waitFor(() => expect(input('/api/mobile/v1/actions/saveCompany')).toMatchObject({ website: 'https://nile.example', version: 3 }));
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();

    server.on('POST /api/mobile/v1/actions/saveCompany', { ok: false, error: 'stale' });
    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));
    expect(await screen.findByText(ar.employer.companyMoved)).toBeTruthy();
  });

  it('keeps what is typed when a logo or a paper moves the version, and saves it on the new one', async () => {
    // What the database does on each: the row changes, and bump_version() moves the version.
    server.on('POST /api/mobile/v1/actions/uploadImage', () => {
      company = { ...(company as CompanyRow), logo_url: 'https://example/logo.webp', version: 4 };
      return { ok: true, data: { url: 'https://example/logo.webp' } };
    });
    server.on('POST /api/mobile/v1/actions/recordCompanyDocument', () => {
      // company_review_state(): a paper in moves an unverified company to pending (migration 44).
      company = { ...(company as CompanyRow), verification_status: 'pending', version: 5 };
      return { ok: true };
    });
    server.on('POST /api/mobile/v1/actions/saveCompany', () => {
      company = { ...(company as CompanyRow), about_ar: typed, version: 6 };
      return { ok: true, data: { id: baseCompany.id } };
    });
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library/logo.png', width: 600, height: 300 }],
    } as ImagePicker.ImagePickerResult);
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/card.pdf', name: 'card.pdf', mimeType: 'application/pdf', size: 4096, lastModified: 0 }],
    } as DocumentPicker.DocumentPickerResult);
    renderRouter(app, { initialUrl: '/employer/company' });

    const typed = 'نبذة جديدة لسه ما اتحفظتش';
    fireEvent.changeText(await screen.findByLabelText(ar.companies.aboutAr), typed);
    fireEvent.press(screen.getByRole('button', { name: ar.employer.logoUpload }));
    // The viewer is read again, with the logo, at version 4.
    expect(await screen.findByRole('button', { name: `${ar.common.delete}: ${ar.employer.logo}` })).toBeTruthy();
    expect(screen.getByLabelText(ar.companies.aboutAr).props.value).toBe(typed);

    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.uploadDoc}: ${ar.employer.taxCard}` }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/recordCompanyDocument')).toHaveLength(1));
    // Read again at version 5; the form is the one it was.
    await waitFor(() => expect(server.asked('/rest/v1/companies')).toHaveLength(3));
    expect(screen.getByLabelText(ar.companies.aboutAr).props.value).toBe(typed);

    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));
    await waitFor(() => expect(input('/api/mobile/v1/actions/saveCompany')).toMatchObject({ aboutAr: typed }));
    expect([4, 5]).toContain(input('/api/mobile/v1/actions/saveCompany')?.version);
    // Its own save coming back at version 6 leaves the form, and the word that it saved, where they are.
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();
    await waitFor(() => expect(server.asked('/rest/v1/companies')).toHaveLength(4));
    await waitFor(() => expect(screen.getByText(ar.common.saveSuccess)).toBeTruthy());
    expect(screen.getByLabelText(ar.companies.aboutAr).props.value).toBe(typed);
  });

  it("shows a colleague's version once the save it overtook is refused", async () => {
    server.on('POST /api/mobile/v1/actions/saveCompany', () => ({ ok: false, error: 'stale' }));
    renderRouter(app, { initialUrl: '/employer/company' });

    fireEvent.changeText(await screen.findByLabelText(ar.companies.aboutAr), 'ما كتبته أنا');
    // A colleague saves in between.
    company = { ...(company as CompanyRow), about_ar: 'ما كتبه الزميل', version: 4 };
    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));

    expect(await screen.findByText(ar.employer.companyMoved)).toBeTruthy();
    expect(input('/api/mobile/v1/actions/saveCompany')).toMatchObject({ version: 3 });
    await waitFor(() => expect(screen.getByLabelText(ar.companies.aboutAr).props.value).toBe('ما كتبه الزميل'));
  });

  it('refuses an address that is not http(s) before sending anything', async () => {
    renderRouter(app, { initialUrl: '/employer/company' });
    fireEvent.changeText(await screen.findByLabelText(ar.companies.website), 'javascript:alert(1)');
    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));
    expect(await screen.findByText(ar.validation.invalidUrl)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/saveCompany')).toHaveLength(0);
  });

  it('sends the logo to the website as drawn, a PNG for the company', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library/logo.png', width: 600, height: 300 }],
    } as ImagePicker.ImagePickerResult);
    renderRouter(app, { initialUrl: '/employer/company' });

    fireEvent.press(await screen.findByRole('button', { name: ar.employer.logoUpload }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/uploadImage')).toHaveLength(1));
    // Not cropped: a logo keeps its shape.
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: false }));
    // The request as Expo's fetch builds it on the phone: the logo's own bytes.
    const sent = await sentBody(server.asked('/api/mobile/v1/actions/uploadImage')[0].body);
    expect(sent).toContain('content-disposition: form-data; name="kind"\r\n\r\nlogo\r\n');
    expect(sent).toContain(`content-disposition: form-data; name="companyId"\r\n\r\n${baseCompany.id}\r\n`);
    expect(sent).toContain(
      'content-disposition: form-data; name="file"; filename="logo.png"\r\ncontent-type: image/png\r\n\r\nthe bytes of logo.png\r\n',
    );
  });

  it("uploads a paper to the company's folder, and takes it back out when the website refuses it", async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/card.pdf', name: 'card.pdf', mimeType: 'application/pdf', size: 4096, lastModified: 0 }],
    } as DocumentPicker.DocumentPickerResult);
    renderRouter(app, { initialUrl: '/employer/company' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.uploadDoc}: ${ar.employer.taxCard}` }));
    await waitFor(() => expect(input('/api/mobile/v1/actions/recordCompanyDocument')).toBeTruthy());
    const recorded = input('/api/mobile/v1/actions/recordCompanyDocument');
    expect(recorded).toMatchObject({ companyId: baseCompany.id, docType: 'tax_card' });
    expect(String(recorded?.storagePath)).toMatch(new RegExp(`^${baseCompany.id}/tax_card-[0-9a-f-]{36}\\.pdf$`));

    server.on('POST /api/mobile/v1/actions/recordCompanyDocument', { ok: false, error: 'file_type' });
    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.uploadDoc}: ${ar.employer.taxCard}` }));
    expect(await screen.findByText(ar.validation.fileType)).toBeTruthy();
    await waitFor(() => expect(server.asked('/storage/v1/object/company-documents')).toHaveLength(1));
  });

  it('takes a paper photographed, or from the library, as a JPEG — not only a file from Files', async () => {
    paperFrom = 1;
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library/IMG_0042.HEIC', width: 4032, height: 3024 }],
    } as ImagePicker.ImagePickerResult);
    renderRouter(app, { initialUrl: '/employer/company' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.uploadDoc}: ${ar.employer.commercialRegister}` }));
    await waitFor(() => expect(input('/api/mobile/v1/actions/recordCompanyDocument')).toBeTruthy());
    expect(String(input('/api/mobile/v1/actions/recordCompanyDocument')?.storagePath)).toMatch(
      new RegExp(`^${baseCompany.id}/commercial_register-[0-9a-f-]{36}\\.jpg$`),
    );
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
    expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file:///library/IMG_0042.HEIC');
  });

  it('says how to allow the camera when the phone refuses it', async () => {
    paperFrom = 0;
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({ granted: false } as ImagePicker.CameraPermissionResponse);
    renderRouter(app, { initialUrl: '/employer/company' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.uploadDoc}: ${ar.employer.taxCard}` }));
    expect(await screen.findByText(ar.app.company.cameraDenied)).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it("adds a colleague, says the website's word when it cannot, and takes one off after asking", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderRouter(app, { initialUrl: '/employer/company' });

    fireEvent.changeText(await screen.findByLabelText(ar.employer.teamEmail), 'mona@example.com');
    fireEvent.press(screen.getByRole('button', { name: ar.employer.teamAdd }));
    await waitFor(() => expect(input('/api/mobile/v1/actions/addCompanyMember')).toEqual({ email: 'mona@example.com', role: 'recruiter' }));

    // The daily look-up limit is "too many, wait" as well as the hourly one.
    server.on('POST /api/mobile/v1/actions/addCompanyMember', { ok: false, error: 'rate_limit' });
    fireEvent.changeText(screen.getByLabelText(ar.employer.teamEmail), 'hany@example.com');
    fireEvent.press(screen.getByRole('button', { name: ar.employer.teamAdd }));
    expect(await screen.findByText(ar.employer.teamRateLimited)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.teamRemove}: —` }));
    answerAlert(alert, ar.employer.teamRemove);
    await waitFor(() => expect(input('/api/mobile/v1/actions/removeCompanyMember')).toEqual({ userId: RECRUITER }));
    alert.mockRestore();
  });

  it('says an address is not one before sending it, and when the website says so', async () => {
    renderRouter(app, { initialUrl: '/employer/company' });

    fireEvent.changeText(await screen.findByLabelText(ar.employer.teamEmail), 'mona@example');
    fireEvent.press(screen.getByRole('button', { name: ar.employer.teamAdd }));
    expect(await screen.findByText(ar.validation.invalidEmail)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/addCompanyMember')).toHaveLength(0);

    // A shape the phone takes and the website's check does not: its word, not "try again".
    server.on('POST /api/mobile/v1/actions/addCompanyMember', { ok: false, error: 'invalid' });
    fireEvent.changeText(screen.getByLabelText(ar.employer.teamEmail), 'mona@example.c');
    fireEvent.press(screen.getByRole('button', { name: ar.employer.teamAdd }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/addCompanyMember')).toHaveLength(1));
    expect(await screen.findByText(ar.validation.invalidEmail)).toBeTruthy();
    expect(screen.queryByText(ar.common.errorBody)).toBeNull();
  });
});

describe("the company's page, for a recruiter", () => {
  it('shows the team and who can change it, and none of the controls the database would refuse', async () => {
    role = 'recruiter';
    renderRouter(app, { initialUrl: '/employer/company' });

    expect(await screen.findByText(ar.employer.teamOnlyAdmins)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.employer.logoUpload }) === null).toBe(true);
    expect(screen.queryByLabelText(ar.companies.nameAr) === null).toBe(true);
    expect(screen.queryByText(ar.employer.verification) === null).toBe(true);
    expect(screen.queryByLabelText(ar.employer.teamEmail) === null).toBe(true);
  });
});

describe('a company that could not be read', () => {
  it('is never offered the form that makes one, which would overwrite it', async () => {
    // The membership call drops; it is a POST, so nothing retries it underneath.
    server.on('POST /rest/v1/rpc/my_company_id', () => {
      throw new TypeError('Network request failed');
    });
    renderRouter(app, { initialUrl: '/employer/company' });

    expect(await screen.findByText(ar.app.offline.title)).toBeTruthy();
    expect(screen.queryByLabelText(ar.companies.nameAr)).toBeNull();
    expect(screen.queryByRole('button', { name: ar.employer.createCompanyFirst })).toBeNull();

    server.on('POST /rest/v1/rpc/my_company_id', () => baseCompany.id);
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    await waitFor(() => expect(screen.getByLabelText(ar.companies.nameAr).props.value).toBe(baseCompany.name_ar));
    expect(server.asked('/api/mobile/v1/actions/saveCompany')).toHaveLength(0);
  });

  it('keeps the page, and what is typed on it, when a read in the background fails', async () => {
    renderRouter(app, { initialUrl: '/employer/company' });
    fireEvent.changeText(await screen.findByLabelText(ar.companies.aboutAr), 'نص بكتبه');

    let failed = 0;
    server.on('/rest/v1/profiles', () => {
      failed += 1;
      throw new TypeError('Network request failed');
    });
    await act(async () => {
      await screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    await waitFor(() => expect(failed).toBe(1));
    // Let the failed read land: TanStack tells the screens on a timer (fake, under renderRouter).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByLabelText(ar.companies.aboutAr).props.value).toBe('نص بكتبه');
    expect(screen.queryByText(ar.app.offline.title)).toBeNull();
  });
});

describe('nobody signed in', () => {
  it('asks to sign in on the company and billing pages, rather than waiting for an account that is not coming', async () => {
    await supabase.auth.signOut({ scope: 'local' });
    renderRouter(app, { initialUrl: '/employer/company' });
    expect(await screen.findByRole('button', { name: ar.nav.signIn })).toBeTruthy();
    expect(screen.queryByLabelText(ar.common.loading)).toBeNull();
  });
});

describe('an employer without a company', () => {
  it('makes one from the same form', async () => {
    company = null;
    renderRouter(app, { initialUrl: '/employer/company' });
    fireEvent.changeText(await screen.findByLabelText(ar.companies.nameAr), 'النيل للوساطة');
    fireEvent.press(screen.getByRole('button', { name: ar.employer.createCompanyFirst }));
    await waitFor(() => expect(input('/api/mobile/v1/actions/saveCompany')).toMatchObject({ nameAr: 'النيل للوساطة' }));
    expect(input('/api/mobile/v1/actions/saveCompany')?.version).toBeUndefined();
  });
});

describe('billing', () => {
  it('shows the credits and gives a verified company its free post — when the database says it was given', async () => {
    company = { ...baseCompany, verification_status: 'verified', post_credits: 2 };
    server.on('GET /rest/v1/orders', [
      { id: 'o1', company_id: baseCompany.id, pack_key: 'single', credits: 1, amount_egp: 1000, paymob_order_id: null, status: 'paid', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
    ]);
    renderRouter(app, { initialUrl: '/employer/billing' });

    expect(await screen.findByText('2')).toBeTruthy();
    expect(screen.getByText(ar.billing.disabled)).toBeTruthy();
    expect(screen.getByText(ar.billing.orderStatus.paid)).toBeTruthy();
    // Nothing is sold in the app.
    expect(screen.queryByRole('button', { name: ar.billing.buy }) === null).toBe(true);

    server.on('POST /api/mobile/v1/actions/claimMonthlyFreePost', { ok: true, data: { claimed: false } });
    fireEvent.press(screen.getByRole('button', { name: ar.employer.freePostClaim }));
    expect(await screen.findByText(ar.employer.freePostRefused)).toBeTruthy();

    server.on('POST /api/mobile/v1/actions/claimMonthlyFreePost', { ok: true, data: { claimed: true } });
    fireEvent.press(screen.getByRole('button', { name: ar.employer.freePostClaim }));
    expect(await screen.findByText(ar.employer.freePostClaimed)).toBeTruthy();
  });

  it('offers no free post to a company that is not verified', async () => {
    renderRouter(app, { initialUrl: '/employer/billing' });
    expect(await screen.findByText(ar.billing.credits)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.employer.freePostClaim }) === null).toBe(true);
  });

  it('reads the balance and the badge again on a pull, not only the orders', async () => {
    company = { ...baseCompany, post_credits: 2 };
    renderRouter(app, { initialUrl: '/employer/billing' });
    expect(await screen.findByText('2')).toBeTruthy();

    // Spent on the website, and the company verified meanwhile.
    company = { ...baseCompany, verification_status: 'verified', post_credits: 1 };
    await act(async () => {
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(await screen.findByText('1')).toBeTruthy();
    expect(await screen.findByRole('button', { name: ar.employer.freePostClaim })).toBeTruthy();
  });
});
