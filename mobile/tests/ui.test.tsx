import type { ReactNode } from 'react';
import { Alert, Dimensions, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaInsetsContext, SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { renderRouter } from 'expo-router/testing-library';
import TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import { AuthScroll } from '~/components/auth/auth-scroll';
import { CompanyLogo } from '~/components/companies/company-logo';
import { SetupChecklist } from '~/components/employer/setup-checklist';
import { BarOnly } from '~/components/navigation/page-header';
import { FilterSheetFrame } from '~/components/jobs/filter-sheet';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { KeyboardRoom, roomForScreen } from '~/components/ui/keyboard-room';
import { PageFooter } from '~/components/ui/page-footer';
import { Select } from '~/components/ui/select';
import { EmptyState, ErrorState, InSheet } from '~/components/ui/states';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ApiError } from '~/lib/api';
import { dialog, readingOrder } from '~/lib/dialog';
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
const logo = (name: string) => `${env.supabaseUrl}/storage/v1/object/public/company-logos/${name}/logo.webp`;

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
    render(<CompanyLogo name="النيل" logoUrl={logo('nile')} />, { wrapper: Providers });
    act(() => screen.UNSAFE_getByType(Image).props.onError());
    expect(screen.getByText('ا', drawn)).toBeTruthy();
    expect(screen.queryByText('ا')).toBeNull();
    expect(screen.UNSAFE_queryByType(Image)).toBeNull();
  });

  it("is the company's letter, never fetched, for a logo on any other host", () => {
    // The column's path on a tracker's host: migration 344 cannot tell the hosts apart.
    render(
      <CompanyLogo name="النيل" logoUrl="https://tracker.example/storage/v1/object/public/company-logos/c1/p.png" />,
      { wrapper: Providers },
    );
    expect(screen.UNSAFE_queryByType(Image)).toBeNull();
    expect(screen.getByText('ا', drawn)).toBeTruthy();
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

describe('a state that is the whole screen', () => {
  /*
    Under a large title and over the tab bar, iOS gives a scroll view the
    bars' height as insets whenever it is inside a navigation or tab
    controller ("automatic"), even when what it holds fits: then the words
    sat some 120 points below the middle and dragged up and down by the
    height of both bars. Insets only once it scrolls ("scrollableAxes"), and
    it scrolls only when the words and the button under them are taller
    than the room the bars leave: at the largest text sizes, or on the
    smallest phone turned on its side. While it fits, the words sit in the
    middle of that room, padded clear of whatever bar covers the scroll view
    where it is on the screen.
  */
  const screenHeight = Dimensions.get('window').height;
  const bars = { top: 59, bottom: 83, left: 0, right: 0 };
  let header = 155;
  function UnderTheBars({ children }: { children: ReactNode }) {
    return (
      <Providers>
        <SafeAreaInsetsContext.Provider value={bars}>
          <HeaderHeightContext.Provider value={header}>{children}</HeaderHeightContext.Provider>
        </SafeAreaInsetsContext.Provider>
      </Providers>
    );
  }
  // React Native's stand-ins share one measureInWindow mock; this places the scroll view on the screen.
  const inWindow = jest.spyOn(ScrollView.prototype as unknown as { measureInWindow: (...args: unknown[]) => void }, 'measureInWindow');
  afterEach(() => inWindow.mockReset());
  const laidOut = (box: { y: number; height: number }, words: number) => {
    inWindow.mockImplementation((done: unknown) => (done as (x: number, y: number, w: number, h: number) => void)(0, box.y, 393, box.height));
    const scroll = screen.UNSAFE_getByType(ScrollView);
    fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 393, height: box.height } } });
    const content = within(scroll)
      .UNSAFE_getAllByType(View)
      .find((view) => typeof view.props.onLayout === 'function');
    if (!content) throw new Error('the words are not measured');
    fireEvent(content, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 329, height: words } } });
    return screen.UNSAFE_getByType(ScrollView);
  };
  const padded = (scroll: ReturnType<typeof screen.UNSAFE_getByType>) => {
    const style = scroll.props.contentContainerStyle as { paddingTop: number; paddingBottom: number };
    return [style.paddingTop, style.paddingBottom];
  };
  // A tab's root under a large title: the scroll view fills the screen, under both bars.
  const wholeScreen = { y: 0, height: screenHeight };

  beforeEach(() => {
    header = 155;
  });

  it('sits still in the middle of the room the bars leave when it fits: no insets, nothing to drag', () => {
    render(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />, { wrapper: UnderTheBars });
    const scroll = laidOut(wholeScreen, 260);
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('scrollableAxes');
    expect(scroll.props.alwaysBounceVertical).toBe(false);
    // 32 of its own padding, and clear of the header (155) and the tab bar (83) it lies under.
    expect(padded(scroll)).toEqual([32 + 155, 32 + 83]);
  });

  it('scrolls, clear of the header and the tab bar, to the button under its words when they are taller than the room', () => {
    render(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />, { wrapper: UnderTheBars });
    // The screen less 155 (header) and 83 (tab bar) is the room: words that,
    // with the padding around them, are taller scroll, and iOS insets them.
    const scroll = laidOut(wholeScreen, screenHeight - 155 - 83 - 60);
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('scrollableAxes');
    expect(scroll.props.alwaysBounceVertical).toBe(true);
    expect(padded(scroll)).toEqual([32, 32]);
    expect(within(scroll).getByRole('button', { name: ar.common.retry })).toBeTruthy();
  });

  it('counts a header it is not under as no part of its room', () => {
    // Under an ordinary title the header is opaque and the screen starts
    // below it: only the tab bar covers the scroll view. Counted twice, the
    // header made words that fit scroll and drag by the tab bar's height.
    header = 103;
    render(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />, { wrapper: UnderTheBars });
    const below = { y: 103, height: screenHeight - 103 };
    const scroll = laidOut(below, below.height - 83 - 64 - 20);
    expect(scroll.props.alwaysBounceVertical).toBe(false);
    expect(padded(scroll)).toEqual([32, 32 + 83]);
  });

  it('keeps clear of a header with a search field, rather than sinking its top under it', () => {
    // A large title and a search field always shown come to about 207 points.
    header = 207;
    render(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />, { wrapper: UnderTheBars });
    const scroll = laidOut(wholeScreen, screenHeight - 207 - 83 - 64 - 10);
    expect(scroll.props.alwaysBounceVertical).toBe(false);
    expect(padded(scroll)).toEqual([32 + 207, 32 + 83]);
  });

  it('does not stop scrolling under the finger as the large title collapses', () => {
    render(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />, { wrapper: UnderTheBars });
    const words = screenHeight - 155 - 83 - 60;
    expect(laidOut(wholeScreen, words).props.alwaysBounceVertical).toBe(true);
    // Scrolled, the title folds into a 103-point bar: the room grows, but it
    // was decided against the largest the header has been.
    header = 103;
    screen.rerender(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />);
    expect(screen.UNSAFE_getByType(ScrollView).props.alwaysBounceVertical).toBe(true);
  });

  it("waits for a large title's own height, which comes a tenth of a second late, before it is seen", () => {
    // The first frame has the header at an ordinary bar's height; the large
    // title's comes 100 ms later (the native stack's debounce). Shown at the
    // first measure, the words dropped some 26 points once they were in view.
    jest.useFakeTimers();
    try {
      header = 98;
      render(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />, { wrapper: UnderTheBars });
      const opacity = () => {
        const content = within(screen.UNSAFE_getByType(ScrollView))
          .UNSAFE_getAllByType(View)
          .find((view) => typeof view.props.onLayout === 'function');
        return StyleSheet.flatten(content?.props.style).opacity;
      };
      laidOut(wholeScreen, 260);
      expect(opacity()).toBe(0);
      act(() => jest.advanceTimersByTime(100));
      header = 155;
      screen.rerender(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />);
      act(() => jest.advanceTimersByTime(149));
      expect(opacity()).toBe(0);
      act(() => jest.advanceTimersByTime(1));
      expect(opacity()).toBe(1);
      expect(padded(screen.UNSAFE_getByType(ScrollView))).toEqual([32 + 155, 32 + 83]);
      // Seen, it stays seen whatever moves after.
      header = 103;
      screen.rerender(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />);
      expect(opacity()).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("in a sheet, keeps clear of the sheet's own edges: not the status bar above it, but the home indicator over its foot", () => {
    // A sheet is measured from its own top, which is below the status bar, and
    // runs to the foot of the phone. Counted against the phone's own edges the
    // words sat some 46 points below the sheet's middle.
    header = 0;
    const sheetBars = { top: 59, bottom: 34, left: 0, right: 0 };
    render(<ErrorState error={new ApiError(0, 'offline')} onRetry={() => {}} />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Providers>
          <SafeAreaInsetsContext.Provider value={sheetBars}>
            <HeaderHeightContext.Provider value={header}>
              <InSheet.Provider value>{children}</InSheet.Provider>
            </HeaderHeightContext.Provider>
          </SafeAreaInsetsContext.Provider>
        </Providers>
      ),
    });
    const scroll = laidOut({ y: 0, height: 783 }, 260);
    expect(scroll.props.alwaysBounceVertical).toBe(false);
    expect(padded(scroll)).toEqual([32, 32 + 34]);
  });

  it("is a block of the list it is the empty state of, which scrolls already: not a scroll inside a scroll", () => {
    render(<FlatList data={[]} renderItem={() => null} ListEmptyComponent={<EmptyState title="nothing yet" />} />, {
      wrapper: Providers,
    });
    expect(screen.getByText('nothing yet')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(ScrollView)).toHaveLength(1);
  });

  it('scrolls itself in a sheet, a window of its own, even over a page that scrolls', () => {
    render(
      <ScrollView>
        <Modal visible>
          <EmptyState title="nothing yet" />
        </Modal>
      </ScrollView>,
      { wrapper: Providers },
    );
    expect(screen.getByText('nothing yet')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(ScrollView)).toHaveLength(2);
  });
});

describe('a label in a row, at the largest text sizes', () => {
  // A line of text in a row that may not shrink runs past the row's edge
  // rather than wrapping: past a button's fill, or pushing a sheet's buttons off the screen.
  const shrinks = (label: ReturnType<typeof screen.getByText>) => StyleSheet.flatten(label.props.style).flexShrink;
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } };

  it('wraps inside its button, chip and badge, beside their icon', () => {
    render(
      <>
        <Button label="a button" icon={<Text>·</Text>} onPress={() => {}} />
        <Chip label="a chip" icon={<Text>·</Text>} onPress={() => {}} />
        <Badge label="a badge" icon={<Text>·</Text>} />
      </>,
      { wrapper: Providers },
    );
    expect(shrinks(screen.getByText('a button'))).toBe(1);
    expect(shrinks(screen.getByText('a chip'))).toBe(1);
    expect(shrinks(screen.getByText('a badge'))).toBe(1);
  });

  it("wraps a sheet's title between its buttons", () => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Select label="a choice" value={null} options={[{ value: 'one', label: 'one' }]} placeholder="any" onChange={() => {}} />
        <FilterSheetFrame visible onClose={() => {}} onClear={() => {}} applyLabel="show" onApply={() => {}}>
          <Text>…</Text>
        </FilterSheetFrame>
      </SafeAreaProvider>,
      { wrapper: Providers },
    );
    fireEvent.press(screen.getByRole('button', { name: 'a choice: any' }));
    expect(shrinks(screen.getByRole('header', { name: 'a choice' }))).toBe(1);
    expect(shrinks(screen.getByRole('header', { name: ar.jobs.filters }))).toBe(1);
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

describe("the app's alerts", () => {
  it('stand Cancel on the right where iOS lays an Arabic question out left to right', () => {
    const withdraw = jest.fn();
    const arranged = readingOrder([
      { text: 'إلغاء', style: 'cancel' },
      { text: 'اسحب الطلب', style: 'destructive', onPress: withdraw },
    ]);
    // iOS keeps the order given unless a button is marked cancel, which it puts first (left).
    expect(arranged.map((button) => [button.text, button.style])).toEqual([
      ['اسحب الطلب', 'destructive'],
      ['إلغاء', 'default'],
    ]);
    arranged[0].onPress?.();
    expect(withdraw).toHaveBeenCalledTimes(1);
  });

  it("are iOS's own, which shows over any sheet, asked as given where nothing needs turning", () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const buttons = [{ text: 'إلغاء', style: 'cancel' as const }, { text: 'تمام' }];
    dialog.alert('سؤال', 'تفاصيل', buttons);
    expect(alert).toHaveBeenCalledWith('سؤال', 'تفاصيل', buttons);
    alert.mockRestore();
  });
});

describe("a stack page's bar", () => {
  const app = {
    _layout: () => (
      <ThemeProvider>
        <I18nProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </I18nProvider>
      </ThemeProvider>
    ),
    '(tabs)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
    '(tabs)/(jobs)/_layout': TabStack,
    '(tabs)/(jobs)/jobs/index': function Board() {
      return (
        <>
          <Stack.Screen
            options={{
              title: 'الوظائف',
              headerRight: () => (
                <BarOnly>
                  <Text>bell</Text>
                </BarOnly>
              ),
            }}
          />
          <Text onPress={() => router.push('/jobs/one')}>open</Text>
        </>
      );
    },
    '(tabs)/(jobs)/jobs/[slug]': () => <Text>the listing</Text>,
  };

  it('is drawn inside the page, so it slides with it, its items once, and Back goes back', async () => {
    renderRouter(app, { initialUrl: '/jobs' });
    expect(await screen.findByText('الوظائف')).toBeTruthy();
    // Once: not again in iOS's own bar, hidden under it.
    expect(screen.getAllByText('bell')).toHaveLength(1);
    // A tab's first page has nowhere to go back to.
    expect(screen.queryByTestId('header-back')).toBeNull();

    fireEvent.press(screen.getByText('open'));
    expect(await screen.findByText('the listing')).toBeTruthy();
    const back = screen.getByRole('button', { name: catalogues.ar.common.back });
    fireEvent.press(back);
    await waitFor(() => expect(screen.queryByText('the listing')).toBeNull());
  });
});

describe('where the keyboard is given room', () => {
  // The root stack as the app has it, and the tabs' own stack; a plain stack stands in for the tab bar.
  const app = {
    _layout: () => (
      <ThemeProvider>
        <I18nProvider>
          <Stack screenOptions={{ headerShown: false }} screenLayout={roomForScreen} />
        </I18nProvider>
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
