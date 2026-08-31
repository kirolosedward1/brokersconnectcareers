import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

/** The section has no landing page of its own; send readers to its first tab. */
export default async function DashboardIndexPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  redirect({ href: '/dashboard/applications', locale });
}
