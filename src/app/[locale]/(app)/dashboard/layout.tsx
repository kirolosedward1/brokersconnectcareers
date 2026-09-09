import { setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';

/**
 * No guard here, deliberately.
 *
 * This used to call requireCandidate, which was redundant for four of the five
 * pages under it — the overview, applications, saved jobs and the profile all
 * call it themselves — and wrong for the fifth. /dashboard/account is reached
 * from the console rail by *every* role, because changing your password or
 * exporting your data is not a candidate's privilege; the page says so and
 * uses requireProfile. The layout above it disagreed, so an employer or an
 * admin clicking "إعدادات الحساب" was bounced to /employer/jobs and the link
 * simply did not work for them.
 *
 * The chrome — rail, top bar, canvas — comes from the (app) group layout, and
 * each page states its own audience. That is the arrangement that cannot drift
 * apart from what the pages actually allow.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale(asLocale((await params).locale));
  return <>{children}</>;
}
