import { SiteFooter } from '@/components/site-footer';

/**
 * Everything with a footer.
 *
 * The auth screens deliberately sit outside this group: a sign-in page with a
 * full sitemap under it invites the reader to wander off mid-task, and Next
 * gives no way to unmount a parent layout's footer from a child.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
