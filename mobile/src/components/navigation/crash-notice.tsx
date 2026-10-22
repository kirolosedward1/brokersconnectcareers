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
/** Long enough for the welcome, or Home, to be on screen. */
const NOTICE_AFTER_MS = 2500;

export function CrashNotice() {
  const t = useTranslations('app.crash');
  useEffect(() => {
    let live = true;
    // After the launch's own screens have come up (the welcome is presented
    // as the app opens): iOS shows nothing presented while another is.
    const timer = setTimeout(() => {
      readLastCrash().then((crash) => {
        if (!crash || !live) return;
        void forgetLastCrash();
        dialog.alert(t('title'), t('body'), [
          { text: t('dismiss'), style: 'cancel' },
          { text: t('send'), onPress: () => void Share.share({ message: crashReport(crash) }).catch(() => {}) },
        ]);
      });
    }, NOTICE_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Once per launch: the words are the same catalogue's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
