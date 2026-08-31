import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

/** The section has no landing page of its own; send readers to its first tab. */
export default async function EmployerIndexPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  redirect({ href: '/employer/jobs', locale });
}
