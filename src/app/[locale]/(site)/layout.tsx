import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
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

  return (
    <>
      <SiteHeader locale={locale as Locale} />
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
