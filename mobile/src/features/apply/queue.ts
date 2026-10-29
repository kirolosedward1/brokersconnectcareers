import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import type { ApplyInput } from '@/lib/mobile-api/contract';
import { localized } from '@/lib/locale';
import { toast } from '~/components/feedback/toast';
import { ApplyRefused, invalidateAfterApplying, submitApplication, type Attachment } from '~/features/apply/apply';
import { noAnswer } from '~/lib/api';
import { createLocalList } from '~/lib/local-list';
import { useSession } from '~/lib/session';

/**
 * Applications written with no connection (v1.1), kept on this phone for
 * the person who wrote them (local-list.ts: per account, gone with it) and
 * sent once the phone is back — as the app comes to the front, and every half
 * minute while one waits. One per listing: a second for the same listing
 * replaces the first. A refusal (the listing closed meanwhile, an application
 * already in) takes it off the queue and says so; another missing answer
 * leaves it for the next try. A CV is sent as it was chosen: a path already
 * in the candidate's folder, or the file picked, which waits in the app's
 * cache (emptied on signing out, when the queue goes too).
 */
export type QueuedApplication = {
  jobId: string;
  slug: string;
  titleAr: string;
  titleEn: string | null;
  input: Omit<ApplyInput, 'cvPath'>;
  attachment: Attachment;
  queuedAt: string;
};

export const applyQueue = createLocalList<QueuedApplication>('bc.apply-queue.v1', {
  max: 10,
  idOf: (item) => item.jobId,
  valid: (item): item is QueuedApplication => {
    const queued = item as QueuedApplication | null;
    return typeof queued?.jobId === 'string' && typeof queued?.input?.jobId === 'string';
  },
});

/** Whether a failure is the phone having no connection, the one that is queued rather than said. */
export function offlineFailure(failure: unknown): boolean {
  return !(failure instanceof ApplyRefused) && noAnswer(failure);
}

const EVERY = 30_000;

/**
 * Sends what waits in the queue for the signed-in person: at once, as the app
 * comes to the front, and every half minute while anything waits. One run at
 * a time.
 */
export function useApplyQueueRunner() {
  const t = useTranslations('app.apply');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const userId = useSession().session?.user.id ?? null;
  const waiting = applyQueue.useItems(userId ?? 'anon');
  const running = useRef(false);
  const latest = useRef({ t, locale, queryClient });
  useEffect(() => {
    latest.current = { t, locale, queryClient };
  });

  useEffect(() => {
    if (!userId || !waiting.length) return;
    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        for (const item of await applyQueue.read(userId)) {
          const { t: say, locale: here, queryClient: client } = latest.current;
          const title = localized(here, item.titleAr, item.titleEn);
          try {
            await submitApplication(userId, { input: item.input, attachment: item.attachment });
            applyQueue.remove(userId, item.jobId);
            invalidateAfterApplying(client);
            toast.show({ message: say('queuedSent', { title }), tone: 'success' });
          } catch (failure) {
            if (offlineFailure(failure)) break;
            applyQueue.remove(userId, item.jobId);
            // Already in: the first try reached the website after all.
            if (failure instanceof ApplyRefused && failure.reason === 'already_applied') {
              invalidateAfterApplying(client);
              toast.show({ message: say('queuedSent', { title }), tone: 'success' });
            } else {
              toast.show({ message: say('queuedFailed', { title }), tone: 'destructive' });
            }
          }
        }
      } finally {
        running.current = false;
      }
    };
    void run();
    const timer = setInterval(() => void run(), EVERY);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [userId, waiting.length]);
}
