/* eslint-disable @typescript-eslint/no-require-imports -- the router's own route builder, loaded as the app loads it.
   Node's modules are required as tests/route-targets.test.ts does: the app's typings have no Node in them. */
import { withoutLeakedParams } from '~/lib/leaked-params';
import { webEntryHref } from '~/lib/web-entry-path';

type Dirent = { name: string; isDirectory: () => boolean };
const fs = require('node:fs') as {
  readdirSync: (dir: string, options: { withFileTypes: true }) => Dirent[];
  statSync: (path: string) => { isDirectory: () => boolean };
};
const path = require('node:path') as {
  join: (...parts: string[]) => string;
};
declare const __dirname: string;

/**
 * The real route files, not the stand-in tree in routing.test.tsx. A pasted
 * `/jobs/<slug>` matches every tab's copy; the web router was picking Account,
 * so Back was `/account?slug=…`. Naming the tab first opens the Jobs stack.
 */

type Route = { name: string; params?: Record<string, unknown>; state?: State };
type State = {
  index?: number;
  routes: Route[];
};

function linkingConfig() {
  const { getRoutes } = require('expo-router/build/getRoutes') as {
    getRoutes: (context: { (key: string): unknown; keys: () => string[] }, options: object) => unknown;
  };
  const { getReactNavigationConfig } = require('expo-router/build/getReactNavigationConfig') as {
    getReactNavigationConfig: (routes: unknown, metaOnly: boolean) => unknown;
  };
  const appDir = path.join(__dirname, '../src/app');
  const walk = (dir: string, base = '.'): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = `${base}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
      else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) out.push(rel);
    }
    return out;
  };
  const anchors = {
    home: { anchor: 'index' },
    jobs: { anchor: 'jobs/index' },
    companies: { anchor: 'companies/index' },
    applications: { anchor: 'dashboard/applications/index' },
    saved: { anchor: 'dashboard/saved/index' },
    account: { anchor: 'account/index' },
    listings: { anchor: 'employer/jobs/index' },
    applicants: { anchor: 'employer/applicants/index' },
    consultants: { anchor: 'agents/index' },
    admin: { anchor: 'admin/index' },
  };
  const keys = walk(appDir).sort();
  const context = ((key: string) => {
    if (key.includes('(home,jobs,')) return { unstable_settings: anchors };
    if (key === './_layout.tsx') return { unstable_settings: { anchor: '(tabs)' } };
    return {};
  }) as { (key: string): unknown; keys: () => string[] };
  context.keys = () => keys;
  const routes = getRoutes(context, { ignoreEntryPoints: true, platform: 'web', skipGenerated: true, importMode: 'sync' });
  return getReactNavigationConfig(routes, true);
}

const config = linkingConfig();

function stateFor(href: string): State {
  const { getStateFromPath } = require('expo-router/build/fork/getStateFromPath') as {
    getStateFromPath: (path: string, options: unknown) => State;
  };
  return getStateFromPath(href, config);
}

function focused(state: State): string[] {
  const names: string[] = [];
  let current: State | undefined = state;
  while (current) {
    const route: Route = current.routes[current.index ?? current.routes.length - 1];
    names.push(route.name);
    current = route.state;
  }
  return names;
}

describe('a listing opened by its URL on the web', () => {
  it('lands in Account, with the slug copied onto that screen', () => {
    const state = stateFor('/jobs/sales-a1b2');
    expect(focused(state)).toEqual(['(tabs)', '(account)', 'jobs/[slug]']);
    const stack = state.routes[0].state?.routes[0].state;
    expect(stack?.routes[0]).toMatchObject({ name: 'account/index', params: { slug: 'sales-a1b2' } });
  });

  it('opens in Jobs once the address names that tab, and Back is the board', () => {
    const href = webEntryHref('/jobs/sales-a1b2', '', null);
    expect(href).toBe('/(jobs)/jobs/sales-a1b2');
    const state = withoutLeakedParams(stateFor(href!));
    expect(focused(state)).toEqual(['(tabs)', '(jobs)', 'jobs/[slug]']);
    const stack = state.routes[0].state?.routes[0].state;
    expect(stack?.routes[0]).toMatchObject({ name: 'jobs/index' });
    expect(stack?.routes[0].params?.slug).toBeUndefined();
    expect(stack?.routes[1].params).toEqual({ slug: 'sales-a1b2' });
  });
});
