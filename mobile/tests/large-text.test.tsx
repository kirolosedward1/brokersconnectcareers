import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render, screen, within } from '@testing-library/react-native';
import { ActionMenu } from '~/components/ui/action-menu';
import { X } from '~/components/ui/lucide';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  At the accessibility text sizes (Settings → Accessibility → Display & Text
  Size → Larger Text) no line is cut short: a name, a title or a file cut to
  its first word and "…" is a line somebody who needs large text cannot read.
  VoiceOver reads the whole string either way; this is for the eyes.
*/

const mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

afterEach(() => {
  mockWindow.fontScale = 1;
});

// Node's own modules, required as tests/server.ts does: the app's typings have no Node in them.
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, readFileSync, statSync } = require('node:fs') as {
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: 'utf8') => string;
  statSync: (path: string) => { isDirectory: () => boolean };
};
const { join, relative } = require('node:path') as { join: (...parts: string[]) => string; relative: (from: string, to: string) => string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** The JSX opening tag around `index`: from its `<` to its closing `>`. */
function tagAround(text: string, index: number): string {
  const start = text.lastIndexOf('<', index);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && text[i - 1] !== '=') return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/*
  Where a fixed line count is right at every size: the segmented control's
  options, which at the accessibility sizes become a Select instead, and the
  share card, a picture of a fixed size captured for a story, never read on
  the phone's screen.
*/
const ALLOWED = new Set(['components/ui/segmented.tsx', 'components/jobs/share-card.tsx']);

describe('a line cut short', () => {
  it('is never cut at the accessibility sizes, unless its size is capped', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const name = relative(SRC, file);
      if (ALLOWED.has(name)) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/numberOfLines=\{([^}]*)\}/g)) {
        const expression = match[1];
        // Lifted at the accessibility sizes: the limit is asked of useLargeText(), not merely sometimes undefined.
        if (/\blarge\b/.test(expression)) continue;
        const tag = tagAround(text, match.index);
        // Text whose size is capped, or that never grows (the tab bar's names), never reaches them.
        if (/maxFontSizeMultiplier=|allowFontScaling=\{false\}/.test(tag)) continue;
        // One word that shrinks to fit its cell (a month in the picker's grid): wrapping would split it.
        if (/adjustsFontSizeToFit/.test(tag)) continue;
        offenders.push(`${name}:${text.slice(0, match.index).split('\n').length} numberOfLines={${expression}}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('a chosen value in a Select', () => {
  const ar = catalogues.ar;
  const long = 'التجمع الخامس — القاهرة الجديدة، شارع التسعين الشمالي';

  function Providers({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, bottom: 0, left: 0, right: 0 } }}>
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  const field = () => (
    <Select label={ar.jobs.sortBy} value="far" options={[{ value: 'far', label: long }]} placeholder="—" onChange={() => {}} />
  );

  it('is one line at the ordinary sizes', () => {
    render(field(), { wrapper: Providers });
    expect(screen.getByText(long).props.numberOfLines).toBe(1);
  });

  it('wraps at the accessibility sizes', () => {
    mockWindow.fontScale = 3.571;
    render(field(), { wrapper: Providers });
    expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
  });
});

describe("a held card's menu", () => {
  // A listing's whole title, as the header shows it at the accessibility sizes.
  const title = 'مدير مبيعات عقارية أول — مشروعات سكنية وتجارية في التجمع الخامس والعاصمة الإدارية الجديدة';

  function Providers({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, bottom: 0, left: 0, right: 0 } }}>
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  it('is never taller than the screen, and scrolls what does not fit', () => {
    mockWindow.fontScale = 3.571;
    const items = ['open', 'share', 'save', 'hide', 'fewer'].map((label) => ({ label, icon: X, onPress: () => {} }));
    render(
      <ActionMenu visible onClose={() => {}} onDismiss={() => {}} header={<Text>{title}</Text>} items={items} />,
      { wrapper: Providers },
    );

    const scroll = screen.UNSAFE_getByType(ScrollView);
    expect(within(scroll).getByText(title)).toBeTruthy();
    for (const { label } of items) expect(within(scroll).getByRole('menuitem', { name: label })).toBeTruthy();

    // The card around it is bounded by the window, less the status bar and its margins.
    let card = scroll.parent;
    while (card && StyleSheet.flatten(card.props.style)?.maxHeight === undefined) card = card.parent;
    const { maxHeight } = StyleSheet.flatten(card?.props.style) ?? {};
    expect(typeof maxHeight).toBe('number');
    expect(maxHeight as number).toBeLessThan(mockWindow.height - 20);
  });
});
