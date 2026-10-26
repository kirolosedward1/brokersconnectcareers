import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SignInGateProvider } from '@/components/auth/sign-in-gate';
import { SessionProvider } from '@/components/session/session-provider';
import { LivePolicyNotice } from '@/components/session/live-policy-notice';
import { enabledProviders } from '@/lib/auth-providers';
import { clientIdForOneTap } from '@/lib/auth/google-one-tap';
import { GoogleOneTap } from '@/components/auth/google-one-tap';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

/**
 * Everything with the marketing chrome: header, content, footer.
 *
 * The header used to live in the root layout, which put it above the signed-in
 * console as well — and HeaderShell carried a hand-written list of path
 * prefixes to hide itself on. That list drifted the moment /notifications was
 * added to the (app) group: the page rendered the marketing header stacked on
 * top of the console's own, two headers deep.
 *
 * Owning it here removes the question. The (app) group never renders this
 * layout, so it cannot inherit a header; the auth screens sit outside both
 * groups for the same reason they sit outside the footer — a sign-in page with
 * a full sitemap under it invites the reader to wander off mid-task.
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // For the sign-in dialog Save, Follow and Apply open over a page; cached
  // for five minutes, as the sign-in page's own read is.
  const providers = await enabledProviders();
  // Server-only. The name has no NEXT_PUBLIC_ prefix, so the browser bundle
  // never contains it. This layout passes the value down as a prop; One Tap
  // is mounted only when it is a real web client id. The sign-in page asks
  // GoTrue whether Google is enabled and does not need the id.
  const googleClientId = clientIdForOneTap(process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID);
  const tLegal = await getTranslations('legal');
  const link = (href: '/terms' | '/privacy') =>
    function PolicyLink(chunks: React.ReactNode) {
      return (
        <Link href={href} target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
          {chunks}
        </Link>
      );
    };

  return (
    <SignInGateProvider locale={locale as Locale} googleEnabled={providers.google} appleEnabled={providers.apple}>
      {/* The chrome is the visitor's. A session cookie fills the account
          cluster in the browser, which is what lets these pages be cached. */}
      <SessionProvider>
        <Suspense fallback={null}>
          {providers.google && googleClientId ? (
            <GoogleOneTap clientId={googleClientId} locale={locale as Locale} />
          ) : null}
        </Suspense>
        <SiteHeader locale={locale as Locale} />
        <LivePolicyNotice agreeLabel={tLegal('agree')} failedLabel={tLegal('agreeFailed')}>
          <div className="text-sm">
            <p id="policy-notice-title" className="font-medium">
              {tLegal('updatedTitle')}
            </p>
            <p className="mt-0.5 leading-relaxed text-muted-foreground">
              {tLegal.rich('updatedBody', { terms: link('/terms'), privacy: link('/privacy') })}
            </p>
          </div>
        </LivePolicyNotice>
        <main id="main" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <SiteFooter locale={locale} />
      </SessionProvider>
    </SignInGateProvider>
  );
}
