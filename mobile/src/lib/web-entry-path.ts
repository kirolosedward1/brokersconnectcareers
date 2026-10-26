import { Platform } from 'react-native';
import type { Actor } from '@/lib/permissions';
import { readLastActorSync } from './last-actor';
import { routeFromOutside } from './links';

/**
 * Where a web address opens, named with the tab that owns it.
 *
 * A pasted `/jobs/<slug>` matches every tab's copy of that screen. The web
 * router picks the Account copy, so the listing opens in Account and Back is
 * `/account?slug=…`. Native cold starts already go through routeFromOutside
 * (+native-intent), which names the tab. The web's linking does not call
 * that, so this does, once, before the router reads the address.
 *
 * Returns null when the address is already the one the router should see.
 */
export function webEntryHref(pathname: string, search: string, actor: Actor): string | null {
  const current = `${pathname}${search}` || '/';
  const next = routeFromOutside(current, actor);
  return next && next !== current ? next : null;
}

type Browser = {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState(state: unknown, title: string, url: string): void };
};

const browser = globalThis as Partial<Browser>;
if (Platform.OS === 'web' && browser.location && browser.history) {
  const next = webEntryHref(browser.location.pathname, browser.location.search, readLastActorSync());
  if (next) browser.history.replaceState(browser.history.state, '', `${next}${browser.location.hash}`);
}
