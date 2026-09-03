import { setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireEmployer } from '@/lib/auth';

/**
 * The guard for this section, and nothing else. The chrome — rail, top bar,
 * canvas — comes from the (app) group layout above.
 */
export default async function EmployerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  await requireEmployer(locale);

  return <>{children}</>;
}
