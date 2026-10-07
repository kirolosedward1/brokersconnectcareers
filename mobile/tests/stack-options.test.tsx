import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { useStackOptions } from '~/components/navigation/stack-options';
import { ThemeProvider } from '~/theme/provider';

/*
  On iOS 26 a large title shows only on a clear bar: given a colour, the bar
  keeps the title's room and leaves it empty until the screen is scrolled —
  the owner's Jobs and Companies tabs opened on a blank band over their search
  field. From iOS 26 the stacks leave the bar's colour to React Navigation,
  clear behind a large title and the page's colour elsewhere (the navigation
  theme's card, src/app/_layout.tsx); before it, and on Android, they paint
  the bar the page's colour themselves.
*/

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

function optionsOn(os: 'ios' | 'android', version: string | number) {
  const saved = (['OS', 'Version'] as const).map((key) => [key, Object.getOwnPropertyDescriptor(Platform, key)] as const);
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
  try {
    return renderHook(() => useStackOptions(), { wrapper }).result.current;
  } finally {
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(Platform, key, descriptor);
  }
}

it('leaves the bar clear for a large title on iOS 26', () => {
  expect(optionsOn('ios', '26.0').headerStyle).toBeUndefined();
  expect(optionsOn('ios', '27.1').headerStyle).toBeUndefined();
});

it("paints the bar the page's colour before iOS 26, and on Android", () => {
  for (const options of [optionsOn('ios', '18.6'), optionsOn('android', 35)]) {
    expect(options.headerStyle).toEqual({ backgroundColor: options.contentStyle && 'backgroundColor' in options.contentStyle ? options.contentStyle.backgroundColor : 'missing' });
  }
});
