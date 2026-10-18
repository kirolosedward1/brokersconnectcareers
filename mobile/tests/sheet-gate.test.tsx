import { act, renderHook } from '@testing-library/react-native';
import { leaveSheets, sheetsClosingForTests, sheetsShowing, useGatedModal } from '~/lib/sheet-gate';
import { useSheet } from '~/lib/use-sheet';

/*
  No sheet is shown while another is still being taken down: iOS refuses to
  present one then, and its button stayed dead until the screen was left —
  Filters tapped as the order's card faded, the second of two pickers tapped
  as the first slid away. A sheet asked for meanwhile opens once the other
  has gone (its Modal's onDismiss), or a moment later whatever iOS says.
*/

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('opens a sheet asked for while another is closing once that one has gone', () => {
  const sort = renderHook(() => useSheet());
  const menu = renderHook(() => useSheet());
  act(() => sort.result.current.show());
  act(() => sort.result.current.hide());
  expect(sheetsClosingForTests()).toBe(1);

  // Asked for as the first fades: not yet, rather than a sheet iOS refuses.
  act(() => menu.result.current.show());
  expect(menu.result.current.open).toBe(false);

  act(() => sort.result.current.onDismiss());
  expect(menu.result.current).toMatchObject({ open: true, mounted: true });
  expect(sheetsClosingForTests()).toBe(0);
});

it('opens it a moment later when iOS never says the first has gone', () => {
  const sort = renderHook(() => useSheet());
  const menu = renderHook(() => useSheet());
  act(() => sort.result.current.show());
  act(() => sort.result.current.hide());
  act(() => menu.result.current.show());
  act(() => jest.advanceTimersByTime(800));
  expect(menu.result.current.open).toBe(true);
});

it('shows a sheet opened by a flag (the filters, a picker) only once no other is closing, and counts its own closing', () => {
  const sort = renderHook(() => useSheet());
  const filters = renderHook(({ wanted }: { wanted: boolean }) => useGatedModal(wanted, jest.fn()), { initialProps: { wanted: false } });

  act(() => sort.result.current.show());
  act(() => sort.result.current.hide());
  filters.rerender({ wanted: true });
  expect(filters.result.current.visible).toBe(false);
  act(() => sort.result.current.onDismiss());
  expect(filters.result.current.visible).toBe(true);

  // Closed: the next sheet waits for it in turn, until its Modal says it has gone.
  filters.rerender({ wanted: false });
  expect(filters.result.current.visible).toBe(false);
  expect(sheetsClosingForTests()).toBe(1);
  act(() => sort.result.current.show());
  expect(sort.result.current.open).toBe(false);
  act(() => filters.result.current.onDismiss());
  expect(sort.result.current.open).toBe(true);
});

it('drops an open asked for and then called off before it could happen', () => {
  const sort = renderHook(() => useSheet());
  const filters = renderHook(({ wanted }: { wanted: boolean }) => useGatedModal(wanted, jest.fn()), { initialProps: { wanted: false } });
  act(() => sort.result.current.show());
  act(() => sort.result.current.hide());
  filters.rerender({ wanted: true });
  filters.rerender({ wanted: false });
  act(() => sort.result.current.onDismiss());
  expect(filters.result.current.visible).toBe(false);
  expect(sheetsClosingForTests()).toBe(0);
});

it('runs what was chosen in a sheet once it has gone, before the next waiting sheet', () => {
  const menu = renderHook(() => useSheet());
  const then = jest.fn();
  act(() => menu.result.current.show());
  act(() => menu.result.current.hide(then));
  expect(then).not.toHaveBeenCalled();
  act(() => menu.result.current.onDismiss());
  expect(then).toHaveBeenCalledTimes(1);
  // Closing one that is not open does what was asked at once, and holds nothing up.
  const other = jest.fn();
  act(() => menu.result.current.hide(other));
  expect(other).toHaveBeenCalledTimes(1);
  expect(sheetsClosingForTests()).toBe(0);
});

describe('leaving every sheet, to go elsewhere of the app\'s own accord', () => {
  it('goes at once when no sheet shows', () => {
    const go = jest.fn();
    leaveSheets(go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('closes a sheet showing and goes once it has gone, not before', () => {
    const menu = renderHook(() => useSheet());
    act(() => menu.result.current.show());
    expect(sheetsShowing()).toBe(1);
    const go = jest.fn();
    act(() => leaveSheets(go));
    expect(menu.result.current.open).toBe(false);
    expect(go).not.toHaveBeenCalled();
    act(() => menu.result.current.onDismiss());
    expect(go).toHaveBeenCalledTimes(1);
    expect(sheetsShowing()).toBe(0);
  });

  it("closes a sheet opened by a flag through its owner's own close", () => {
    let wanted = true;
    const close = jest.fn(() => {
      wanted = false;
    });
    const filters = renderHook(() => useGatedModal(wanted, close));
    expect(filters.result.current.visible).toBe(true);
    const go = jest.fn();
    act(() => leaveSheets(go));
    expect(close).toHaveBeenCalledTimes(1);
    filters.rerender({});
    expect(filters.result.current.visible).toBe(false);
    expect(go).not.toHaveBeenCalled();
    act(() => filters.result.current.onDismiss());
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('goes a moment later all the same when a sheet does not close (one that asks first)', () => {
    renderHook(() => useGatedModal(true, () => {}));
    const go = jest.fn();
    act(() => leaveSheets(go));
    expect(go).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1500));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('no longer counts a sheet taken away while showing', () => {
    const menu = renderHook(() => useSheet());
    act(() => menu.result.current.show());
    menu.unmount();
    expect(sheetsShowing()).toBe(0);
    const go = jest.fn();
    leaveSheets(go);
    expect(go).toHaveBeenCalledTimes(1);
  });
});
