import type { ReactNode } from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Platform, Pressable, Share, Text, type AlertButton } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { router, Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { Actor } from '@/lib/permissions';
import { PendingPath } from '~/components/navigation/pending-path';
import { useWithdrawApplication } from '~/features/applications/queries';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { env } from '~/lib/env';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AuthLayout from '../src/app/(auth)/_layout';
import * as SignInScreen from '../src/app/(auth)/sign-in/index';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as JobScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/jobs/[slug]';
import * as ApplyScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/jobs/[slug]/apply';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { board, cairo, jobPage, listing, newCairo } from './fixtures';
import { placeViewsAt } from './measure';
import { fakeServer } from './server';

/*
  Applying, as a candidate does it on a phone: the real listing and apply
  screens, the real client, stand-ins for Supabase (REST and Storage) and the
  website. What is checked is what is uploaded where, what the website's
  applyToJob is sent, what is taken back out when it refuses, and which of its
  states the page shows to whom.
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

// The system's document picker, and the file it hands back as bytes.
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ arrayBuffer: async () => new ArrayBuffer(2048) })),
}));

const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const user = authUser();
const PROFILE_CV = `${USER_ID}/profile-cv.pdf`;
const APPLY = `/jobs/${listing.slug}/apply`;

const candidate: Actor = { userId: USER_ID, profile: { role: 'candidate', approval_status: 'approved' }, company: null };

function picked(asset: Partial<DocumentPicker.DocumentPickerAsset> = {}) {
  return {
    canceled: false,
    assets: [{ uri: 'file:///cache/cv.pdf', name: 'cv.pdf', mimeType: 'application/pdf', size: 2048, lastModified: 0, ...asset }],
  } as DocumentPicker.DocumentPickerResult;
}

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset();

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/api/mobile/v1/jobs', board([listing, { ...listing, id: 'other-role', slug: 'other-role', title_ar: 'مدير مبيعات' }]));
  server.on(`/api/mobile/v1/jobs/${listing.slug}`, jobPage);
  server.on('POST /api/mobile/v1/actions/recordJobView', { ok: true });
  server.on('GET /rest/v1/applications', []);
  server.on('GET /rest/v1/agent_profiles', [{ cv_path: PROFILE_CV, tracks: ['primary'], district_ids: [newCairo.id], years_experience: 2 }]);
  server.on('GET /rest/v1/saved_jobs', []);
  server.on('POST /api/mobile/v1/actions/applyToJob', { ok: true });
  server.on('POST /storage/v1/object/cvs/*', { Id: 'object-1', Key: 'cvs/uploaded' });
  server.on('DELETE /storage/v1/object/cvs', []);

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  server.requests.length = 0;
});

async function signedIn(actor: Actor = candidate) {
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor(actor);
  server.requests.length = 0;
}

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

/** A withdrawal from elsewhere in the app (the Applications tab), on the same cache. */
let withWithdrawal = false;
function Withdrawal() {
  const withdraw = useWithdrawApplication();
  return <Pressable accessibilityRole="button" accessibilityLabel="withdraw elsewhere" onPress={() => withdraw.mutate('a-1')} />;
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
              <PendingPath />
              {withWithdrawal ? <Withdrawal /> : null}
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const SHARED = '(tabs)/(jobs,applications)';

const app = {
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  [`${SHARED}/_layout`]: TabStack,
  [`${SHARED}/jobs/[slug]`]: JobScreen,
  [`${SHARED}/jobs/[slug]/apply`]: ApplyScreen,
  '(tabs)/(jobs)/jobs/index': () => <Text>the board</Text>,
  '(tabs)/(applications)/dashboard/applications/index': () => <Text>applications</Text>,
  '(auth)/_layout': AuthLayout,
  '(auth)/sign-in/index': SignInScreen,
};

const bodyOf = (path: string, index = 0) => server.asked(path)[index]?.body as Record<string, unknown> | undefined;
const uploads = () => server.requests.filter((request) => request.method === 'POST' && request.url.pathname.startsWith('/storage/v1/object/cvs/'));

describe('the form', () => {
  it("sends the CV already on the profile, and says what was sent where", async () => {
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    expect(await screen.findByText(ar.app.apply.profileCv)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/applyToJob')).toEqual({
        input: {
          jobId: listing.id,
          fullName: profile.full_name,
          whatsapp: profile.whatsapp_phone,
          experienceBand: 'junior_1_3',
          note: null,
          cvPath: PROFILE_CV,
        },
      }),
    );
    expect(uploads()).toHaveLength(0);
    expect(await screen.findByText(ar.apply.success)).toBeTruthy();
    expect(screen.getByText(listing.title_ar)).toBeTruthy();
    // Two more roles while the candidate is here, ranked against their profile.
    expect(await screen.findByText(ar.apply.nextRolesMatched)).toBeTruthy();
    expect(screen.getByText('مدير مبيعات')).toBeTruthy();
  });

  it('asks who sees the application above the button, the answer a tap away', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    const question = await screen.findByRole('button', { name: ar.apply.privacyTitle });
    expect(ar.apply.privacyTitle.endsWith('؟')).toBe(true);
    expect(question.props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    expect(screen.queryByText(ar.apply.privacyBody)).toBeNull();

    fireEvent.press(question);
    expect(screen.getByRole('button', { name: ar.apply.privacyTitle }).props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: true }),
    );
    expect(screen.getByText(ar.apply.privacyBody)).toBeTruthy();
    expect(screen.getByText(ar.apply.privacyProfile)).toBeTruthy();
    expect(screen.getByText(ar.apply.privacyNote)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: ar.apply.privacyTitle }));
    expect(screen.queryByText(ar.apply.privacyBody)).toBeNull();
  });

  it("follows the profile's CV as it is now: one replaced in another tab while the form was open is sent in its place", async () => {
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });
    expect(await screen.findByText(ar.app.apply.profileCv)).toBeTruthy();

    // Replaced on the profile, in another tab, while the form was open.
    const REPLACED = `${USER_ID}/new-cv.pdf`;
    server.on('GET /rest/v1/agent_profiles', [{ cv_path: REPLACED, tracks: ['primary'], district_ids: [newCairo.id], years_experience: 2 }]);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(server.asked('/rest/v1/agent_profiles').length).toBeGreaterThan(1));
    // The answer in.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));
    await waitFor(() => expect((bodyOf('/api/mobile/v1/actions/applyToJob')?.input as { cvPath: string }).cvPath).toBe(REPLACED));
  });

  it('sends no CV when the one on the profile was taken off while the form was open', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });
    expect(await screen.findByText(ar.app.apply.profileCv)).toBeTruthy();

    server.on('GET /rest/v1/agent_profiles', [{ cv_path: null, tracks: ['primary'], district_ids: [newCairo.id], years_experience: 2 }]);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(screen.queryByText(ar.app.apply.profileCv)).toBeNull());
    fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));
    await waitFor(() => expect((bodyOf('/api/mobile/v1/actions/applyToJob')?.input as { cvPath: string | null }).cvPath).toBeNull());
  });

  it("uploads a picked CV to the candidate's own folder, and takes it back out when the application is refused", async () => {
    server.on('GET /rest/v1/agent_profiles', []);
    server.on('POST /api/mobile/v1/actions/applyToJob', { ok: false, error: 'already_applied' });
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(picked());
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.apply.pickCv }));
    expect(await screen.findByText('cv.pdf')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));

    expect(await screen.findByText(ar.apply.alreadyApplied)).toBeTruthy();
    const [upload] = uploads();
    const path = upload.url.pathname.replace('/storage/v1/object/cvs/', '');
    expect(path).toMatch(new RegExp(`^${USER_ID}/[0-9a-f-]{36}\\.pdf$`));
    expect((bodyOf('/api/mobile/v1/actions/applyToJob')?.input as { cvPath: string }).cvPath).toBe(path);
    await waitFor(() => expect(bodyOf('/storage/v1/object/cvs')).toEqual({ prefixes: [path] }));
  });

  it('keeps the CV when the answer is lost, and confirms once the database says the application went in', async () => {
    server.on('GET /rest/v1/agent_profiles', []);
    let recorded = false;
    server.on('GET /rest/v1/applications', () => (recorded ? [{ id: 'a-1', created_at: '2026-09-29T10:00:00Z' }] : []));
    // The website writes the application, and its answer never reaches the
    // phone: the app suspended in the background, a lift, Wi-Fi to mobile data.
    server.on('POST /api/mobile/v1/actions/applyToJob', () => {
      recorded = true;
      throw new TypeError('Network request failed');
    });
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(picked());
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.apply.pickCv }));
    expect(await screen.findByText('cv.pdf')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));

    expect(await screen.findByText(ar.apply.success)).toBeTruthy();
    expect(uploads()).toHaveLength(1);
    expect(server.asked('/storage/v1/object/cvs')).toHaveLength(0);
  });

  it('keeps the CV when neither the answer nor the database can be reached, and says it did not go through', async () => {
    server.on('GET /rest/v1/agent_profiles', []);
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(picked());
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.apply.pickCv }));
    expect(await screen.findByText('cv.pdf')).toBeTruthy();
    server.on('POST /api/mobile/v1/actions/applyToJob', () => {
      throw new TypeError('Network request failed');
    });
    server.on('GET /rest/v1/applications', () => {
      throw new TypeError('Network request failed');
    });
    fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));

    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    // The form is still there, with the file, for another try.
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    expect(server.asked('/storage/v1/object/cvs')).toHaveLength(0);
  });

  it('takes the CV back out when the website turns the request away before the action runs', async () => {
    server.on('GET /rest/v1/agent_profiles', []);
    server.on('POST /api/mobile/v1/actions/applyToJob', { status: 413, body: { error: 'too_large' } });
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(picked());
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.apply.pickCv }));
    expect(await screen.findByText('cv.pdf')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));

    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    const path = uploads()[0].url.pathname.replace('/storage/v1/object/cvs/', '');
    await waitFor(() => expect(bodyOf('/storage/v1/object/cvs')).toEqual({ prefixes: [path] }));
  });

  it('holds the form while the application is on its way, and says so rather than "not saved"', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/applyToJob', () => new Promise((resolve) => (answer = resolve)));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      await signedIn();
      const result = renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
      fireEvent.press(await screen.findByRole('button', { name: ar.jobs.apply }));
      await waitFor(() => expect(result.getPathname()).toBe(APPLY));
      expect(await screen.findByText(ar.app.apply.profileCv)).toBeTruthy();
      fireEvent.changeText(screen.getByLabelText(ar.apply.note), 'متاحة من أول الشهر.');
      fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));
      await waitFor(() => expect(server.asked('/api/mobile/v1/actions/applyToJob')).toHaveLength(1));

      // Back while it is being sent: held, and told why — no way to leave it unsaved.
      act(() => router.back());
      expect(alert).toHaveBeenCalledWith(ar.app.leave.sendingTitle, ar.app.leave.sendingBody, expect.any(Array));
      const choices = alert.mock.calls[0][2] as AlertButton[];
      expect(choices.find((button) => button.style === 'destructive')).toBeUndefined();
      expect(result.getPathname()).toBe(APPLY);

      // Answered: the candidate sees that it went in.
      await act(async () => {
        answer({ ok: true });
        await jest.advanceTimersByTimeAsync(300);
      });
      expect(await screen.findByText(ar.apply.success)).toBeTruthy();
    } finally {
      alert.mockRestore();
    }
  });

  it('refuses a file that is too big, or is not a CV, before anything is sent', async () => {
    server.on('GET /rest/v1/agent_profiles', []);
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce(picked({ size: 11 * 1024 * 1024 }));
    fireEvent.press(await screen.findByRole('button', { name: ar.app.apply.pickCv }));
    expect(await screen.findByText(ar.validation.fileTooLarge)).toBeTruthy();

    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce(picked({ name: 'photo.png', mimeType: 'image/png' }));
    fireEvent.press(screen.getByRole('button', { name: ar.app.apply.pickCv }));
    expect(await screen.findByText(ar.validation.fileType)).toBeTruthy();
    expect(uploads()).toHaveLength(0);
  });

  it('names a Word file by its extension when the provider does not say what it is', async () => {
    server.on('GET /rest/v1/agent_profiles', []);
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(picked({ name: 'سيرة.docx', mimeType: 'application/octet-stream' }));
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.apply.pickCv }));
    fireEvent.press(await screen.findByRole('button', { name: ar.apply.submit }));
    await waitFor(() => expect(uploads()).toHaveLength(1));
    expect(uploads()[0].url.pathname).toMatch(/\.docx$/);
  });

  it('catches a phone number the website would refuse, without sending anything — in view and said', async () => {
    await signedIn();
    const announce = AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock;
    announce.mockClear();
    const layout = placeViewsAt(260);
    try {
      renderRouter(app, { initialUrl: APPLY });
      fireEvent.changeText(await screen.findByLabelText(ar.apply.whatsapp), '123');
      fireEvent.press(screen.getByRole('button', { name: ar.apply.submit }));
      expect(await screen.findByText(ar.validation.invalidPhone)).toBeTruthy();
      expect(server.asked('/api/mobile/v1/actions/applyToJob')).toHaveLength(0);
      expect(announce).toHaveBeenCalledWith(ar.validation.invalidPhone, { queue: true });
      await waitFor(() => expect(layout.scrollTo).toHaveBeenCalledWith({ y: 260 - 16, animated: true }));
    } finally {
      layout.undo();
    }
  });

  it("says the website's words when it has had enough applications for today", async () => {
    server.on('POST /api/mobile/v1/actions/applyToJob', { ok: false, error: 'rate_limit' });
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });

    fireEvent.press(await screen.findByRole('button', { name: ar.apply.submit }));
    expect(await screen.findByText(ar.apply.rateLimit)).toBeTruthy();
  });
});

describe('who gets the form', () => {
  it('tells a candidate who has applied already, instead of a second form', async () => {
    server.on('GET /rest/v1/applications', [{ id: 'a-1', created_at: '2026-09-20T10:00:00Z' }]);
    await signedIn();
    renderRouter(app, { initialUrl: APPLY });
    expect(await screen.findByText(ar.apply.alreadyApplied)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.apply.viewApplications })).toBeTruthy();
  });

  it('offers the form again once that application is withdrawn', async () => {
    let applications = [{ id: 'a-1', created_at: '2026-09-20T10:00:00Z' }];
    server.on('GET /rest/v1/applications', () => applications);
    server.on('POST /api/mobile/v1/actions/withdrawApplication', () => {
      applications = [];
      return { ok: true };
    });
    withWithdrawal = true;
    try {
      await signedIn();
      renderRouter(app, { initialUrl: APPLY });
      expect(await screen.findByText(ar.apply.alreadyApplied)).toBeTruthy();

      fireEvent.press(screen.getByRole('button', { name: 'withdraw elsewhere' }));
      await waitFor(() => expect(server.asked('/api/mobile/v1/actions/withdrawApplication')).toHaveLength(1));
      // Not "you have applied already" for the half-minute the answer was kept.
      expect(await screen.findByRole('button', { name: ar.apply.submit })).toBeTruthy();
      expect(screen.queryByText(ar.apply.alreadyApplied)).toBeNull();
    } finally {
      withWithdrawal = false;
    }
  });

  it('leads to the listing from its title when opened from a link, not to what the tab had underneath', async () => {
    server.on('GET /rest/v1/applications', [{ id: 'a-1', created_at: '2026-09-20T10:00:00Z' }]);
    await signedIn();
    const result = renderRouter(app, { initialUrl: APPLY });
    fireEvent.press(await screen.findByRole('button', { name: listing.title_ar }));
    await waitFor(() => expect(result.getPathname()).toBe(`/jobs/${listing.slug}`));
  });

  it('goes back to the listing it was opened from', async () => {
    server.on('GET /rest/v1/applications', [{ id: 'a-1', created_at: '2026-09-20T10:00:00Z' }]);
    await signedIn();
    const result = renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.apply }));
    await waitFor(() => expect(result.getPathname()).toBe(APPLY));
    fireEvent.press(await screen.findByRole('button', { name: listing.title_ar }));
    await waitFor(() => expect(result.getPathname()).toBe(`/jobs/${listing.slug}`));
    // Back from the listing leaves the tab, rather than returning to the apply page.
    act(() => router.back());
    expect(result.getPathname()).not.toBe(APPLY);
  });

  it('tells a candidate the database would refuse why, before they type anything', async () => {
    server.on('/rest/v1/profiles', [{ ...profile, approval_status: 'pending' }]);
    await signedIn({ ...candidate, profile: { role: 'candidate', approval_status: 'pending' } });
    renderRouter(app, { initialUrl: APPLY });
    expect(await screen.findByText(ar.apply.suspendedTitle)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.apply.submit })).toBeNull();
  });

  it('asks somebody signed out to sign in, and to come back to the form', async () => {
    const result = renderRouter(app, { initialUrl: APPLY });
    fireEvent.press(await screen.findByRole('button', { name: ar.nav.signIn }));
    await waitFor(() => expect(result.getPathname()).toBe('/sign-in'));
    expect(result.getSearchParams()).toEqual({ next: APPLY });
  });

  it("opens from the listing's Apply button", async () => {
    await signedIn();
    const result = renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.apply }));
    await waitFor(() => expect(result.getPathname()).toBe(APPLY));
  });
});

describe('sharing a listing', () => {
  const url = `${env.siteUrl}/jobs/${listing.slug}?src=share`;
  afterEach(() => jest.restoreAllMocks());

  it('asks link or picture, and hands iOS the link as a link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_, pick) => pick(0));
    renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.share }));
    expect(sheet.mock.calls[0][0].options).toEqual([ar.app.share.asLink, ar.app.share.asImage, ar.common.cancel]);
    expect(share).toHaveBeenCalledWith({ message: listing.title_ar, url });
  });

  it('shows the listing as a picture first, then hands the picture to the share sheet', async () => {
    jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_, pick) => pick(1));
    renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.share }));
    expect(await screen.findByText(ar.app.share.hiring)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.app.share.send }));
    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///tmp/listing-card.png', expect.objectContaining({ mimeType: 'image/png' })),
    );
    expect(captureRef).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 1080, height: 1920 }));
  });

  it("keeps its word in the bar to the bar's size at the largest text sizes, as the bell does", async () => {
    renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    const button = await screen.findByRole('button', { name: ar.jobs.share });
    expect(within(button).getByText(ar.jobs.share).props.maxFontSizeMultiplier).toBe(1.4);
  });

  it('puts the link inside the message on Android, which shares the message alone', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.share }));
    act(() => (alert.mock.calls[0][2] as AlertButton[])[0].onPress?.());
    expect(share).toHaveBeenCalledWith({ message: `${listing.title_ar}\n${url}` });
  });
});
