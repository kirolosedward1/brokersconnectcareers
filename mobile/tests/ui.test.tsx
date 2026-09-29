import type { ReactNode } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AuthScroll } from '~/components/auth/auth-scroll';
import { CompanyLogo } from '~/components/companies/company-logo';
import { Avatar } from '~/components/ui/avatar';
import { PageFooter } from '~/components/ui/page-footer';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ApiError } from '~/lib/api';
import { env } from '~/lib/env';
import { ThemeProvider } from '~/theme/provider';

/*
  Small pieces every list uses: a picture that does not load, and the end of
  a list whose next page did not come.
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
  it("is the person's letter — for that photo only, when the list reuses the row for somebody else", () => {
    const view = render(<Avatar name="سارة" src={photo('sara')} />, { wrapper: Providers });
    act(() => screen.UNSAFE_getByType(Image).props.onError());
    expect(screen.getByText('س')).toBeTruthy();

    view.rerender(<Avatar name="عمر" src={photo('omar')} />);
    expect(screen.UNSAFE_getByType(Image).props.source).toEqual({ uri: photo('omar') });
  });

  it("is the company's letter, not a blank white tile", () => {
    render(<CompanyLogo name="النيل" logoUrl="https://example.com/logo.webp" />, { wrapper: Providers });
    act(() => screen.UNSAFE_getByType(Image).props.onError());
    expect(screen.getByText('ا')).toBeTruthy();
    expect(screen.UNSAFE_queryByType(Image)).toBeNull();
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
