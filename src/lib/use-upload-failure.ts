'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useSessionRecovery } from '@/lib/session-expired';
import { uploadFailure } from '@/lib/upload-failure';

/**
 * The words for a Storage upload that failed (lib/upload-failure.ts), or null
 * when the answer is to sign in again and that has already begun.
 *
 * A refusal by policy is asked about once more before it is explained: with
 * no user behind the session, it was the session, and the person goes to sign
 * in and comes back to the form — which keeps its draft (use-form-draft.ts).
 * With one, the account itself may not upload here (a suspended account, a
 * colleague who is not the company's admin), and saying so beats "try again".
 */
export function useUploadFailure() {
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');
  const recoverSession = useSessionRecovery();

  return useCallback(
    async (error: unknown): Promise<string | null> => {
      const failure = uploadFailure(error);
      if (failure === 'denied') {
        const answer = await createClient()
          .auth.getUser()
          .catch(() => null);
        if (answer?.data.user) return tValidation('uploadDenied');
        // No answer about the session is not an answer that it ended: offline
        // is not signed out, and sending somebody to sign in for it is wrong.
        if (!answer || answer.error?.name === 'AuthRetryableFetchError') return tValidation('uploadNetwork');
        if (recoverSession({ ok: false, error: 'unauthenticated' })) return null;
        return tValidation('uploadDenied');
      }
      if (failure === 'too_large') return tValidation('fileTooLarge');
      if (failure === 'file_type') return tValidation('fileType');
      if (failure === 'network') return tValidation('uploadNetwork');
      return tCommon('errorBody');
    },
    [tValidation, tCommon, recoverSession],
  );
}
