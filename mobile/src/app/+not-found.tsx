import { View } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/states';
import { env } from '~/lib/env';
import { space } from '~/theme/tokens';

/**
 * A path the app has no screen for — a website page that lives only on the
 * website (the blog, the terms), or a link that was never right. The reader is
 * offered the same page on the site, in the in-app browser, and the way home.
 */
export default function NotFoundScreen() {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <>
      <Stack.Screen options={{ title: '', headerShown: true }} />
      <EmptyState
        title={t('common.notFound')}
        body={t('common.notFoundBody')}
        action={
          <View style={{ gap: space[2], alignSelf: 'stretch' }}>
            <Button label={t('common.goHome')} onPress={() => router.replace('/')} />
            {pathname && pathname !== '/' ? (
              <Button
                label={t('app.account.openWebsite')}
                variant="outline"
                onPress={() => WebBrowser.openBrowserAsync(`${env.siteUrl}${pathname}`).catch(() => {})}
              />
            ) : null}
          </View>
        }
      />
    </>
  );
}
