import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FigureTiles } from '~/components/dashboard/figure-tiles';
import { ContactButtons, dialable } from '~/components/ui/contact-buttons';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  How a person is reached (rule 8) — WhatsApp first in its own green, a call
  beside it of at least 44pt — and figures to read: each right to left, and
  at the largest text size.
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
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}

const buttons = (onPress?: (method: 'whatsapp' | 'call') => void) => (
  <Providers>
    <ContactButtons name="سارة عادل" whatsappUrl="https://wa.me/201001234567?text=hi" phone="+20 100 123 4567" onPress={onPress} />
  </Providers>
);

describe('the contact buttons', () => {
  it('open WhatsApp and the dialler, each named for the person, and say which was pressed', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
    const pressed: string[] = [];
    render(buttons((method) => pressed.push(method)));
    fireEvent.press(screen.getByRole('button', { name: ar.app.contact.whatsappTo.replace('{name}', 'سارة عادل') }));
    fireEvent.press(screen.getByRole('button', { name: ar.app.contact.callTo.replace('{name}', 'سارة عادل') }));
    expect(open.mock.calls.map((call) => call[0])).toEqual(['https://wa.me/201001234567?text=hi', 'tel:+201001234567']);
    expect(pressed).toEqual(['whatsapp', 'call']);
    open.mockRestore();
  });

  it('draw no call without a number', () => {
    render(
      <Providers>
        <ContactButtons name="سارة" whatsappUrl="https://wa.me/1" />
      </Providers>,
    );
    expect(screen.queryByRole('button', { name: /^الاتصال/ })).toBeNull();
  });

  it('keep only what a dialler takes', () => {
    expect(dialable('+20 (100) 123-4567')).toBe('+201001234567');
  });

  it('draw right to left', () => {
    expect(render(buttons()).toJSON()).toMatchSnapshot();
  });

  it('draw at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(buttons()).toJSON()).toMatchSnapshot();
  });
});

describe('the figure tiles', () => {
  const tiles = (
    <Providers>
      <FigureTiles
        label="أداء الإعلان"
        tiles={[
          { label: ar.app.listingStats.views, value: 1284 },
          { label: ar.app.listingStats.rate, value: 3.6, percent: true, hint: ar.app.listingStats.rateHint },
        ]}
      />
    </Providers>
  );

  it('draw right to left, the figure first', () => {
    expect(render(tiles).toJSON()).toMatchSnapshot();
  });

  it('draw two to a row at the largest text size', () => {
    mockWindow.fontScale = 3.571;
    expect(render(tiles).toJSON()).toMatchSnapshot();
  });
});
