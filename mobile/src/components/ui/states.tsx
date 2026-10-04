import { createContext, useContext, useEffect, useRef, useState, type Context, type ReactNode } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useTranslations } from 'use-intl';
import { CloudOff, Compass, TriangleAlert, WifiOff, type LucideIcon } from '~/components/ui/lucide';
import { ApiError, noAnswer } from '~/lib/api';
import { useHasBoard } from '~/lib/use-tabs';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { Button } from './button';
import { Text } from './text';

/**
 * React Native's own word that something is inside a scroll view: every
 * ScrollView gives it to what it holds — FlatList and FlashList among them,
 * both drawn in one — and a Modal, a window of its own, starts afresh. It is
 * not in the type definitions, hence the name given here.
 */
const InsideScroll =
  (ScrollView as unknown as { Context?: Context<{ horizontal: boolean } | null> }).Context ??
  createContext<{ horizontal: boolean } | null>(null);

const centered = { alignItems: 'center', justifyContent: 'center', padding: space[8], gap: space[3] } as const;

/**
 * The words in the middle of the space there is. On a screen of their own they
 * scroll: at the largest text sizes, or on the smallest phone on its side, a
 * title, a few lines and a button are taller than the screen, and the button
 * would be out of reach. In a list or a page that scrolls already they are
 * just a block of it — a scroll inside a scroll would take the drags meant for
 * the page.
 */
function Centered({ children }: { children: ReactNode }) {
  const scroll = useContext(InsideScroll);
  if (scroll && !scroll.horizontal) return <View style={[{ flex: 1 }, centered]}>{children}</View>;
  return <CenteredScroll>{children}</CenteredScroll>;
}

/** A scroll view's ref is its native view, which measures itself; React Native's types leave that out. */
type Measurable = { measureInWindow(done: (x: number, y: number, width: number, height: number) => void): void };

/**
 * A screen presented as a sheet on an iPhone (the root stack says so: see
 * src/app/_layout.tsx). A sheet starts below the status bar and runs to the
 * bottom of the phone, and what is drawn in it is measured from the sheet's
 * own top: the status bar is no part of it, and the home indicator covers its
 * foot wherever the sheet's own height ends.
 */
export const InSheet = createContext(false);

/** The bars settle this long after the last of them moves (a large title's height comes 100 ms late). */
const SETTLE_MS = 150;
/** Shown by then whatever happens: a stand-in that never measures, or bars that never settle. */
const SHOW_ANYWAY_MS = 400;

/**
 * A screen of words, in the middle, that scrolls only when they are taller
 * than the room the bars leave.
 *
 * Inside a navigation or tab controller iOS gives a scroll view the bars'
 * height as insets ("automatic") even when what it holds fits, and content as
 * tall as the screen plus those insets always scrolls: the words sat some 120
 * points below the middle of a tab with a large title, and dragged. With
 * "scrollableAxes" the insets come only with scrolling, and it scrolls —
 * bounces, so iOS counts it as scrollable — only once the words are taller
 * than the room. While they fit, they sit in the middle of that room.
 *
 * The room is the scroll view less what covers it, where it is on the screen:
 * a header it lies under (a large title or a search field is see-through; an
 * ordinary one is not, and the screen starts below it), the status bar, the
 * tab bar or the home indicator. The bars settle a moment after the first
 * frame, and a large title folds as a page scrolls, so each is counted at the
 * most it has covered: decided once, the words do not start or stop scrolling
 * under the reader's finger. Until the measures have held still for a moment
 * it is drawn but not seen, so nothing jumps into place: the first frame has a
 * large title's header at the height of an ordinary one, and its own comes a
 * tenth of a second later.
 */
export function CenteredScroll({
  children,
  padding = space[8],
  style,
}: {
  children: ReactNode;
  padding?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useContext(SafeAreaInsetsContext);
  const header = useContext(HeaderHeightContext);
  const inSheet = useContext(InSheet);
  const screenHeight = useWindowDimensions().height;
  const scroll = useRef<ScrollView>(null);
  const [box, setBox] = useState<{ y: number; height: number } | null>(null);
  const [words, setWords] = useState(0);
  const [covered, setCovered] = useState({ height: 0, top: 0, bottom: 0 });
  const [shown, setShown] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  // Where the bars end and begin on the screen: the header (or, with none,
  // the status bar) from the top, the tab bar (or the home indicator) from
  // the bottom — NativeTabs gives each tab the safe area its bar leaves. In a
  // sheet, measured from its own top: its own header, if any, and the home
  // indicator over its foot.
  const topEdge = inSheet ? (header ?? 0) : Math.max(header ?? 0, insets?.top ?? 0);
  const bottomEdge = screenHeight - (insets?.bottom ?? 0);
  if (box) {
    // Kept from render to render (React's "storing information from previous
    // renders"): set only when it grows, so it settles at once.
    const top = Math.max(0, topEdge - box.y);
    const bottom = inSheet ? (insets?.bottom ?? 0) : Math.max(0, box.y + box.height - bottomEdge);
    if (covered.height !== box.height) setCovered({ height: box.height, top, bottom });
    else if (top > covered.top || bottom > covered.bottom) {
      setCovered({ height: box.height, top: Math.max(covered.top, top), bottom: Math.max(covered.bottom, bottom) });
    }
  }

  const measured = box !== null && covered.height === box.height;
  // Shown once what it is measured against has held still, and then for good.
  const measures = measured ? `${box.y}:${box.height}:${covered.top}:${covered.bottom}:${words}` : null;
  useEffect(() => {
    if (shown || measures === null) return;
    const timer = setTimeout(() => setShown(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [measures, shown]);
  // Measured or not, it is shown soon: a stand-in that never measures (or a
  // platform that cannot) leaves the words in the middle of the scroll view.
  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), SHOW_ANYWAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const taller = measured && words + 2 * padding > box.height - covered.top - covered.bottom;
  // Still, the words keep clear of the bars by padding; scrolling, iOS insets them itself.
  const clear = measured && !taller ? covered : { top: 0, bottom: 0 };
  return (
    <ScrollView
      ref={scroll}
      style={[{ flex: 1 }, style]}
      onLayout={() =>
        (scroll.current as unknown as Measurable | null)?.measureInWindow((_x, y, _width, height) => setBox({ y, height }))
      }
      contentInsetAdjustmentBehavior="scrollableAxes"
      // Still while it fits: a spinner or a message that moves under the finger feels loose.
      alwaysBounceVertical={taller}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        padding,
        paddingTop: padding + clear.top,
        paddingBottom: padding + clear.bottom,
      }}
    >
      <View
        onLayout={(event) => setWords(event.nativeEvent.layout.height)}
        style={{ alignSelf: 'stretch', alignItems: 'center', gap: space[3], opacity: shown || gaveUp ? 1 : 0 }}
      >
        {children}
      </View>
    </ScrollView>
  );
}

export function LoadingState() {
  const { colors } = useTheme();
  const t = useTranslations('common');
  return (
    <Centered>
      <ActivityIndicator color={colors.primary} accessibilityLabel={t('loading')} />
    </Centered>
  );
}

/**
 * Nothing here, or nothing yet: an optional mark in a soft disc, what is so,
 * what to do about it, and the way to do it.
 */
/**
 * A list on its way: the shape of the cards that will fill it, still, in the
 * page's muted tone — the place the content will land, rather than a spinner
 * in the middle of nothing. Said as "loading" to VoiceOver, like the spinner.
 */
export function SkeletonList({
  count = 3,
  compact = false,
  inset = true,
}: {
  count?: number;
  compact?: boolean;
  /** Its own margin from the screen's edge; off inside a list that already has one. */
  inset?: boolean;
}) {
  const { colors } = useTheme();
  const t = useTranslations('common');
  const bar = (width: DimensionValue, height: number) => (
    <View style={{ width, height, borderRadius: height / 2, backgroundColor: colors.muted }} />
  );
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('loading')}
      style={{ flex: 1, padding: inset ? gutter : 0, gap: space[3] }}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={{
            ...corner('xl'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: space[4],
            gap: space[3],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <View style={{ width: 44, height: 44, ...corner('md'), backgroundColor: colors.muted }} />
            <View style={{ flex: 1, gap: space[2] }}>
              {bar('72%', 14)}
              {bar('44%', 10)}
            </View>
          </View>
          {compact ? null : (
            <View style={{ gap: space[2] }}>
              {bar('56%', 14)}
              {bar('38%', 10)}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon: Icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  /** A mark for the state, drawn in a soft disc above the title. */
  icon?: LucideIcon;
}) {
  const { colors } = useTheme();
  // At the accessibility sizes the disc gives its room to the words: on the
  // board it pushed the empty state's title to the bottom of the screen.
  const large = useLargeText();
  return (
    <Centered>
      {Icon && !large ? (
        <View
          accessible={false}
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.secondary,
            marginBottom: space[1],
          }}
        >
          <Icon size={26} color={colors.primary} strokeWidth={1.75} />
        </View>
      ) : null}
      <Text variant="headline" weight="semibold" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center', maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {/* As wide as the screen allows, so an action that asks to stretch can; one that does not stays centred. */}
      {action ? <View style={{ marginTop: space[2], alignItems: 'center', alignSelf: 'stretch' }}>{action}</View> : null}
    </Centered>
  );
}

/**
 * What went wrong, in terms the reader can act on: no connection, the service
 * down (their data is safe), or the website's generic "something went wrong".
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations();
  const status = error instanceof ApiError ? error.status : -1;

  const [title, body, Icon] = noAnswer(error)
    ? [t('app.offline.title'), t('app.offline.body'), WifiOff]
    : status === 503
      ? [t('app.unavailable.title'), t('app.unavailable.body'), CloudOff]
      : [t('common.error'), t('common.errorBody'), TriangleAlert];

  return (
    <EmptyState
      title={title}
      body={body}
      icon={Icon}
      action={onRetry ? <Button label={t('common.retry')} variant="outline" onPress={onRetry} /> : null}
    />
  );
}

/**
 * A link to something that is not there, or no longer is — the website's
 * not-found page: what happened, and the way back to the board (home, for
 * somebody whose tab bar has no board).
 */
export function NotFoundState() {
  const t = useTranslations();
  const hasBoard = useHasBoard();
  return (
    <EmptyState
      title={t('common.notFound')}
      body={t('common.notFoundBody')}
      icon={Compass}
      action={
        hasBoard ? (
          <Button label={t('nav.browseJobs')} variant="outline" onPress={() => router.navigate('/jobs')} />
        ) : (
          <Button label={t('app.tabs.home')} variant="outline" onPress={() => router.navigate('/')} />
        )
      }
    />
  );
}
