import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { crashReport, forgetLastCrash, readLastCrash, type Crash } from '~/lib/crash-log';
import { gutter, space } from '~/theme/tokens';

/**
 * After the app was closed by an error of its own (src/lib/crash-log.ts): a
 * notice at the top of Home that says so, and offers the details to send on —
 * WhatsApp, mail, whatever the share sheet has — so the fault can be found.
 *
 * In the page rather than an alert over it: Apple asks that an app not greet
 * people with an alert as it starts (HIG, Alerts), and an alert also had to
 * wait out the welcome and the launch's other screens to be shown at all.
 * It stays until it is answered — sent, or put away with "Not now" — so a
 * launch by a link that never passes Home does not lose it.
 */
export function CrashNotice() {
  const t = useTranslations('app.crash');
  const [crash, setCrash] = useState<Crash | null>(null);

  useEffect(() => {
    let live = true;
    readLastCrash().then((last) => {
      if (live) setCrash(last);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!crash) return null;

  const answered = () => {
    setCrash(null);
    void forgetLastCrash();
  };

  return (
    <View testID="crash-notice" style={{ paddingHorizontal: gutter, paddingTop: space[2], paddingBottom: space[2] }}>
      <Notice tone="muted" title={t('title')}>
        <View style={{ gap: space[3] }}>
          <Text variant="small">{t('body')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Button
              label={t('send')}
              size="sm"
              onPress={() => {
                answered();
                void Share.share({ message: crashReport(crash) }).catch(() => {});
              }}
            />
            <Button label={t('dismiss')} variant="ghost" size="sm" onPress={answered} />
          </View>
        </View>
      </Notice>
    </View>
  );
}
