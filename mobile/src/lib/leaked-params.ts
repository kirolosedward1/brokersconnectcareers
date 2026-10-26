/**
 * Params a deep link copies onto every screen under it.
 *
 * Opening `/jobs/<slug>` builds a stack whose first screen is the tab's
 * anchor and whose focused screen is the listing, and gives both the listing's
 * `slug`. The anchor has nowhere to put it, so the address of Back becomes
 * `/jobs?slug=…` (or `/account?slug=…` when the wrong tab was chosen). A
 * screen whose own path is not `slug` or `id` does not read those.
 */
type NavRoute = {
  name: string;
  key?: string;
  /** A screen's params, as the navigator stores them. Not always a string index. */
  params?: object | undefined;
  state?: NavState | undefined;
};

type NavState = {
  key?: string;
  index?: number;
  type?: string;
  stale?: boolean;
  routes: NavRoute[];
};

const LEAKED = ['slug', 'id'] as const;

function keeps(name: string, key: string): boolean {
  return name.includes(`[${key}]`);
}

export function withoutLeakedParams<T extends NavState>(state: T): T {
  let changed = false;
  const routes = state.routes.map((route) => {
    let params = route.params;
    if (params) {
      const next: Record<string, unknown> = {};
      let dropped = false;
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if ((LEAKED as readonly string[]).includes(key) && !keeps(route.name, key)) {
          dropped = true;
          continue;
        }
        next[key] = value;
      }
      if (dropped) {
        changed = true;
        params = Object.keys(next).length > 0 ? next : undefined;
      }
    }
    let child = route.state;
    if (child) {
      const stripped = withoutLeakedParams(child);
      if (stripped !== child) {
        changed = true;
        child = stripped;
      }
    }
    if (params === route.params && child === route.state) return route;
    return { ...route, params, state: child };
  });
  if (!changed) return state;
  return { ...state, routes };
}
