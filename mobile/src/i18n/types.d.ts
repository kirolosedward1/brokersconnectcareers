import type { Locale } from '@/lib/locale';
import type { Messages } from './provider';

/*
  Every t('…') in the app is checked against the catalogue it will run with:
  a key the website renames or deletes is a compile error here, not a raw key
  path on somebody's screen.
*/
declare module 'use-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
