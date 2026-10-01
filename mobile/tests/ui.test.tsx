import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import { AuthScroll } from '~/components/auth/auth-scroll';
import { CompanyLogo } from '~/components/companies/company-logo';
import { SetupChecklist } from '~/components/employer/setup-checklist';
import { Avatar } from '~/components/ui/avatar';
import { Chip } from '~/components/ui/chip';
import { KeyboardRoom, roomForScreen } from '~/components/ui/keyboard-room';
import { PageFooter } from '~/components/ui/page-footer';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ApiError } from '~/lib/api';
import { env } from '~/lib/env';
import { ThemeProvider } from '~/theme/provider';
import { company } from './fixtures';

/*
  Small pieces every list uses: a picture that does not load, and the end of
  a list whose next page did not come — and what VoiceOver is told of a
  chip in a single choice and of a company's first steps.
*/

const ar = catalogues.ar;

function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}

const photo = (name: string) => `${env.supabaseUrl}/storage/v1/object/public/avatars/${name}.webp`;

describe('a picture that does not load', () => {
  // The letter is drawn, and kept from VoiceOver: the name beside it is what
  // gets read, and a lone "س" before it was noise.
  const drawn = { includeHiddenElements: true };

  it("is the person's letter — for that photo only, when the list reuses the row for somebody else", () => {
    const view = render(<Avatar name="سارة" src={photo('sara')} />, { wrapper: Providers });
    act(() => screen.UNSAFE_getByType(Image).props.onError());
    expect(screen.getByText('س', drawn)).toBeTruthy();
    expect(screen.queryByText('س')).toBeNull();

    view.rerender(<Avatar name="عمر" src={photo('omar')} />);
    expect(screen.UNSAFE_getByType(Image).props.source).toEqual({ uri: photo('omar') });
  });

  it("is the company's letter, not a blank white tile", () => {
    render(<CompanyLogo name="النيل" logoUrl="https://example.com/logo.webp" />, { wrapper: Providers });
    act(() => screen.UNSAFE_getByType(Image).props.onError());
    expect(screen.getByText('ا', drawn)).toBeTruthy();
    expect(screen.queryByText('ا')).toBeNull();
    expect(screen.UNSAFE_queryByType(Image)).toBeNull();
  });

  it('is a letter VoiceOver does not read when there was never a picture', () => {
    render(<Avatar name="عمر" />, { wrapper: Providers });
    expect(screen.getByText('ع', drawn)).toBeTruthy();
    expect(screen.queryByText('ع')).toBeNull();
  });
});

describe('a chip in a single choice', () => {
  it('is a radio button, checked or not, rather than a selected button', () => {
    const onPress = jest.fn();
    const view = render(<Chip label="الأحدث" selected radio onPress={onPress} />, { wrapper: Providers });
    const chip = screen.getByRole('radio', { name: 'الأحدث' });
    expect(chip.props.accessibilityState).toMatchObject({ checked: true });
    expect(chip.props.accessibilityState.selected).toBeUndefined();
    fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);

    view.rerender(<Chip label="الأحدث" radio onPress={onPress} />);
    expect(screen.getByRole('radio', { name: 'الأحدث' }).props.accessibilityState).toMatchObject({ checked: false });
  });

  it('stays a selected button everywhere else', () => {
    render(<Chip label="الفلاتر" selected onPress={() => {}} />, { wrapper: Providers });
    expect(screen.getByRole('button', { name: 'الفلاتر' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe("a company's first steps", () => {
  it('says where each one stands in words, not only with its mark', () => {
    const papersIn = { ...company, about_ar: 'وساطة عقارية.', logo_url: 'https://example.com/logo.webp', verification_status: 'pending' as const };
    render(<SetupChecklist company={papersIn} liveJobs={0} pendingJobs={0} draftJobs={0} />, { wrapper: Providers });
    // Profile filled in, papers with a reviewer, no listing yet.
    expect(screen.getByLabelText(ar.employer.setupStateDone)).toBeTruthy();
    expect(screen.getByLabelText(ar.employer.setupStateWaiting)).toBeTruthy();
    expect(screen.getByLabelText(ar.employer.setupStateTodo)).toBeTruthy();
  });
});

describe('the end of a list', () => {
  const page = (overrides: Partial<Parameters<typeof PageFooter>[0]['query']> = {}) => ({
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    error: null,
    fetchNextPage: jest.fn(),
    ...overrides,
  });

  it('says nothing while there is nothing to say', () => {
    render(<PageFooter query={page()} />, { wrapper: Providers });
    expect(screen.queryByRole('button', { name: ar.common.retry })).toBeNull();
  });

  it('says why the next page did not come, and asks for it again', () => {
    const query = page({ isFetchNextPageError: true, error: new ApiError(0, 'offline') });
    render(<PageFooter query={query} />, { wrapper: Providers });
    expect(screen.getByText(ar.app.offline.body)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(query.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});

describe('a sign-in page', () => {
  // A phone with a status bar and a navigation bar the app is drawn under.
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, bottom: 48, left: 0, right: 0 } };
  const padding = (bare: boolean) => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <AuthScroll bare={bare}>
          <Text>…</Text>
        </AuthScroll>
      </SafeAreaProvider>,
    );
    const { paddingTop, paddingBottom } = screen.UNSAFE_getByType(ScrollView).props.contentContainerStyle;
    return { paddingTop, paddingBottom };
  };

  it('leaves the bars to iOS, which keeps a scroll view clear of them itself', () => {
    expect(padding(true)).toEqual({ paddingTop: 16, paddingBottom: 40 });
  });

  it('keeps clear of them on Android, drawn edge to edge — of the status bar where there is no header', () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      expect(padding(true)).toEqual({ paddingTop: 16 + 24, paddingBottom: 40 + 48 });
      expect(padding(false)).toEqual({ paddingTop: 16, paddingBottom: 40 + 48 });
    } finally {
      os.restore();
    }
  });
});

describe('the keyboard', () => {
  it('leaves iOS to its scroll views, which make room themselves', () => {
    render(
      <KeyboardRoom>
        <Text>a form</Text>
      </KeyboardRoom>,
    );
    expect(screen.UNSAFE_queryByType(KeyboardAvoidingView)).toBeNull();
  });

  it('takes the part of the screen it covers off the bottom on Android, drawn edge to edge', () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      render(
        <KeyboardRoom>
          <Text>a form</Text>
        </KeyboardRoom>,
      );
      expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
      expect(screen.getByText('a form')).toBeTruthy();
    } finally {
      os.restore();
    }
  });
});

describe('where the keyboard is given room', () => {
  // The root stack as the app has it, and the tabs' own stack; a plain stack stands in for the tab bar.
  const app = {
    _layout: () => (
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} screenLayout={roomForScreen} />
      </ThemeProvider>
    ),
    '(tabs)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
    '(tabs)/(jobs)/_layout': TabStack,
    '(tabs)/(jobs)/jobs/index': () => <Text>the board</Text>,
    '(auth)/sign-in': () => <Text>sign in</Text>,
  };
  const rooms = () => screen.UNSAFE_queryAllByType(KeyboardAvoidingView).length;

  afterEach(() => jest.useRealTimers());

  it('on Android, once for a tab, above its tab bar: the keyboard covers the bar rather than lifting it', () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      renderRouter(app, { initialUrl: '/jobs' });
      expect(screen.getByText('the board')).toBeTruthy();
      expect(rooms()).toBe(1);
    } finally {
      os.restore();
    }
  });

  it('on Android, once for a sheet of the root stack', () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      renderRouter(app, { initialUrl: '/sign-in' });
      expect(screen.getByText('sign in')).toBeTruthy();
      expect(rooms()).toBe(1);
    } finally {
      os.restore();
    }
  });

  it('nowhere on iOS', () => {
    renderRouter(app, { initialUrl: '/jobs' });
    expect(screen.getByText('the board')).toBeTruthy();
    expect(rooms()).toBe(0);
  });
});
