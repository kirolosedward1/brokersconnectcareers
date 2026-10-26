import { env } from './env';

/**
 * Mark a page of this website as opened from the app.
 *
 * The in-app browser is still the website, which offers the app there. `app=1`
 * is how this app says it is already open: the site hides that card and
 * remembers the visit in the `bc_app` cookie. A signed CV, a licence text and
 * Cloudflare's notice are other origins, and leave here unchanged. A query and
 * a hash already on the address stay; `app` is set to `1` among them.
 */
export function withAppMarker(input: string): string {
  let url: URL;
  let site: URL;
  try {
    url = new URL(input);
    site = new URL(env.siteUrl);
  } catch {
    return input;
  }
  if (url.origin !== site.origin) return input;
  if (url.searchParams.get('app') === '1') return input;
  url.searchParams.set('app', '1');
  return url.toString();
}
