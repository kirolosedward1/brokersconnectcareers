import { redirect } from '@/i18n/navigation';
import { asLocale, type Locale } from '@/i18n/routing';

/** The section has no landing page of its own; send readers to its first tab. */
export default async function EmployerIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  redirect({ href: '/employer/jobs', locale });
}
