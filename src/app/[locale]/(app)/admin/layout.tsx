import { setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/auth';
import { ConsoleToaster } from '@/components/admin/console-toaster';

/**
 * The guard for this section, and nothing else. The chrome — rail, top bar,
 * canvas — comes from the (app) group layout above.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  await requireAdmin(locale);

  return (
    <>
      {children}
      <ConsoleToaster />
    </>
  );
}
