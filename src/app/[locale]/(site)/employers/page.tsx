import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor } from '@/i18n/routing';
import { EmployerLanding } from '@/components/home/employer-landing';
import { createClient } from '@/lib/supabase/server';

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'landingPage' });

  return {
    title: t('employerHero.title'),
    description: t('employerHero.subtitle'),
    alternates: alternatesFor('/employers', locale),
  };
}

/**
 * The hiring side, as its own indexable page.
 *
 * A separate route rather than a tab on the home page: "real estate
 * recruitment Egypt" and "real estate jobs Egypt" are different searches by
 * different people, and only one of them can be served by a page whose H1
 * talks about finding work.
 */
export default async function EmployersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  // The one live number on the page. An unreachable database renders zero
  // rather than failing the page — the argument stands without it.
  let consultantCount = 0;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from('agent_profiles')
      .select('id', { count: 'exact', head: true });
    consultantCount = count ?? 0;
  } catch {
    /* zero is an honest fallback */
  }

  return <EmployerLanding locale={locale} consultantCount={consultantCount} />;
}
