import { Tabs } from 'expo-router';

/**
 * The tab navigator of a test's router, with a screen declared for each of
 * its children. Since SDK 58 a tab navigator draws only the screens its
 * layout declares, as the app's own (src/app/(tabs)/_layout.tsx) does: a bare
 * <Tabs /> drew nothing at all.
 *
 * `routes` is the test's route map, read when the layout is drawn, so a map
 * may name it for its own '(tabs)/_layout'.
 */
export function DeclaredTabs({ routes }: { routes: Record<string, unknown> }) {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      {tabChildren(routes).map((name) => (
        <Tabs.Screen key={name} name={name} />
      ))}
    </Tabs>
  );
}

/**
 * The children of a route map's '(tabs)' navigator, as Expo Router names
 * them. A group with a layout of its own is one child, '(home)'; a screen in
 * a group without one is a child by its path, '(account)/employer/billing'.
 * A shared group, '(home,jobs)', stands for each group it names.
 */
export function tabChildren(routes: Record<string, unknown>): string[] {
  const groupsOf = (segment: string) => /^\(([^)]+)\)$/.exec(segment)?.[1].split(',').map((name) => `(${name})`) ?? [segment];
  const paths = Object.keys(routes)
    .filter((key) => key.startsWith('(tabs)/') && key !== '(tabs)/_layout')
    .map((key) => key.slice('(tabs)/'.length).split('/'));
  const laidOut = new Set(paths.filter((path) => path.length === 2 && path[1] === '_layout').flatMap((path) => groupsOf(path[0])));
  const names = new Set<string>();
  for (const [first, ...rest] of paths) {
    for (const group of groupsOf(first)) {
      names.add(laidOut.has(group) || !rest.length ? group : [group, ...rest].join('/'));
    }
  }
  return [...names];
}
