import { View } from 'react-native';
import { Stack, router, useGlobalSearchParams, usePathname } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/states';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { startPath } from '~/lib/tabs';
import { space } from '~/theme/tokens';
import { Compass } from '~/components/ui/lucide';

/**
 * The website address a path the app has no screen for was asked as: the path
 * with its query, since the page on the site may need it (an unsubscribe
 * link's token, where a sign-in was headed). expo-router gives the two apart,
 * and a path alone sent the reader to a page that could not do what the link
 * promised.
 */
export function websiteAddress(pathname: string, params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const each of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, each);
  }
  const search = query.toString();
  return `${pathname}${search ? `?${search}` : ''}`;
}

/**
 * A path the app has no screen for — a website page that lives only on the
 * website (the blog, the terms), or a link that was never right. The reader is
 * offered the same page on the site, in the in-app browser, and the way home.
 * Which website pages are allowed to land here is decided by
 * scripts/route-parity.test.mjs: every other page has a screen.
 */
export default function NotFoundScreen() {
  const t = useTranslations();
  const pathname = usePathname();
  const actor = useSession().actor;
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  const address = websiteAddress(pathname, params);

  return (
    <>
      <Stack.Screen options={{ title: '', headerShown: true }} />
      <EmptyState
        icon={Compass}
        title={t('common.notFound')}
        body={t('common.notFoundBody')}
        action={
          <View style={{ gap: space[2], alignSelf: 'stretch' }}>
            <Button label={t('common.goHome')} onPress={() => router.replace(startPath(actor))} />
            {pathname && pathname !== '/' ? (
              <Button
                label={t('app.account.openWebsite')}
                variant="outline"
                onPress={() => WebBrowser.openBrowserAsync(`${env.siteUrl}${address}`).catch(() => {})}
              />
            ) : null}
          </View>
        }
      />
    </>
  );
}
