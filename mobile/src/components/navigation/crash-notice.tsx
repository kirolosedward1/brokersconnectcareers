import { useEffect } from 'react';
import { Share } from 'react-native';
import { useTranslations } from 'use-intl';
import { crashReport, forgetLastCrash, readLastCrash } from '~/lib/crash-log';
import { dialog } from '~/lib/dialog';

/**
 * Once, at the launch after the app was closed by an error of its own
 * (src/lib/crash-log.ts): says so, and offers the details to send on —
 * WhatsApp, mail, whatever the share sheet has — so the fault can be found.
 */
export function CrashNotice() {
  const t = useTranslations('app.crash');
  useEffect(() => {
    let live = true;
    readLastCrash().then((crash) => {
      if (!crash || !live) return;
      void forgetLastCrash();
      dialog.alert(t('title'), t('body'), [
        { text: t('dismiss'), style: 'cancel' },
        { text: t('send'), onPress: () => void Share.share({ message: crashReport(crash) }).catch(() => {}) },
      ]);
    });
    return () => {
      live = false;
    };
    // Once per launch: the words are the same catalogue's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
