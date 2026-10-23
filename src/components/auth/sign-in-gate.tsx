'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Briefcase } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { AuthForm } from '@/components/auth/auth-form';
import { Dialog } from '@/components/ui/dialog';

/**
 * Signing in without leaving the page.
 *
 * Save, Follow and Apply are offered to a signed-out reader, because they are
 * how a reader becomes a candidate. Each used to send them to the sign-in
 * page and bring them back to the listing afterwards — the right destination,
 * but the thing they had pressed was gone, and so was their place on the
 * page. The app's sign-in sheet opens over the screen and comes back to the
 * action; this is the website's sheet.
 *
 * One dialog, mounted once in the site layout; a button asks for it with
 * `useSignInGate()`:
 *
 *   const signedIn = await requireSignIn({ reason: 'save', next: '/jobs/abc' });
 *   if (signedIn) save();
 *
 * The promise answers true once a password sign-in has gone through — the
 * dialog has closed and the server has been asked to draw the page again, so
 * what the page knows about the reader (can they save, are they following)
 * catches up while the action already runs with the new session cookie — and
 * false when the dialog is dismissed. Sign-up and the one-tap providers leave
 * the page as they always did, with `next` pointing back here; a new account
 * has onboarding to pass through first, and OAuth returns through the
 * callback.
 *
 * Without the provider — a page outside the site layout — the gate is the
 * old round trip to the sign-in page, so a caller never has to know which.
 */
export type SignInAsk = {
  reason: 'save' | 'follow' | 'apply' | 'report';
  /** Where to come back to, as a path: the listing, the company, the apply form. */
  next: string;
  /** For Apply: the listing named, so the gate reads as a step inside something already begun. */
  intent?: { job: string; company: string };
};

type Gate = (ask: SignInAsk) => Promise<boolean>;

const SignInGateContext = createContext<Gate | null>(null);

export function useSignInGate(): Gate {
  const gate = useContext(SignInGateContext);
  const router = useRouter();
  return useCallback(
    async (ask: SignInAsk) => {
      if (gate) return gate(ask);
      router.push(`/sign-in?next=${encodeURIComponent(ask.next)}`);
      return false;
    },
    [gate, router],
  );
}

export function SignInGateProvider({
  locale,
  googleEnabled,
  appleEnabled,
  children,
}: {
  locale: Locale;
  googleEnabled: boolean;
  appleEnabled: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [ask, setAsk] = useState<SignInAsk | null>(null);
  const answer = useRef<((signedIn: boolean) => void) | null>(null);

  const settle = useCallback((signedIn: boolean) => {
    answer.current?.(signedIn);
    answer.current = null;
    setAsk(null);
  }, []);

  const gate = useCallback<Gate>(
    (next) => {
      // A second ask while one is open answers the first as dismissed.
      answer.current?.(false);
      setAsk(next);
      return new Promise<boolean>((resolve) => {
        answer.current = resolve;
      });
    },
    [],
  );

  const titles = { save: t('gateSave'), follow: t('gateFollow'), apply: t('gateApply'), report: t('gateReport') } as const;

  return (
    <SignInGateContext.Provider value={gate}>
      {children}
      {ask ? (
        <Dialog open onClose={() => settle(false)} label={titles[ask.reason]} closeLabel={tCommon('close')}>
          <div className="space-y-5">
            <div className="space-y-1 pe-8">
              <h2 className="text-lg font-semibold">{titles[ask.reason]}</h2>
              <p className="text-sm text-muted-foreground">{t('gateLead')}</p>
            </div>

            {/* The listing named, as the sign-in page names it (return-intent.tsx). */}
            {ask.intent ? (
              <div className="flex gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
                <Briefcase className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t('applyingTo', { job: ask.intent.job })}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('applyingToCompany', { company: ask.intent.company })}
                  </p>
                </div>
              </div>
            ) : null}

            <AuthForm
              mode="sign-in"
              locale={locale}
              googleEnabled={googleEnabled}
              appleEnabled={appleEnabled}
              nextPath={ask.next}
              onSignedIn={() => {
                // The page is drawn again for the signed-in reader; the
                // action that asked runs meanwhile, on the cookie already set.
                router.refresh();
                settle(true);
              }}
            />

            <p className="text-center text-sm text-muted-foreground">
              {t('noAccount')}{' '}
              <Link
                href={{ pathname: '/sign-up', query: { next: ask.next } }}
                className="font-medium text-primary hover:underline"
              >
                {t('signUp')}
              </Link>
            </p>
          </div>
        </Dialog>
      ) : null}
    </SignInGateContext.Provider>
  );
}
