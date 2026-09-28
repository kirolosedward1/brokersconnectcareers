import { useCallback } from 'react';
import { useTranslations } from 'use-intl';
import { knownAuthError } from '@/lib/auth/errors';

/**
 * GoTrue's refusals in the reader's language — the website's mapping
 * (src/lib/auth/errors.ts), so the app says the same sentence for the same
 * refusal. Anything unmapped is the generic line, never GoTrue's English.
 */
export function useAuthErrorText() {
  const t = useTranslations();
  return useCallback(
    (error: { message: string; code?: string } | string) => {
      const known = knownAuthError(error);
      if (!known) {
        if (__DEV__) {
          console.warn('[auth] unmapped error', typeof error === 'string' ? error : { code: error.code, message: error.message });
        }
        return t('common.errorBody');
      }
      return t(`${known.namespace}.${known.key}` as never);
    },
    [t],
  );
}
