import { inOwnTab, webPathToAppPath } from '~/lib/links';

/**
 * Every address the system hands the app — a universal link to the website,
 * a brokersconnect:// link, a cold start from either — becomes the app path of
 * the same page, in the tab that page belongs to (src/lib/links.ts). What is
 * not ours opens the home screen.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return inOwnTab(webPathToAppPath(path));
  } catch {
    return '/';
  }
}
