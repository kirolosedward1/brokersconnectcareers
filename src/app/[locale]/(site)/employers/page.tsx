import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor } from '@/i18n/routing';
import { EmployerLanding } from '@/components/home/employer-landing';
import { getViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

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

  /*
    The one live number on the page. An unreachable database renders zero
    rather than failing the page — the argument stands without it.

    Counted with the service role, deliberately: this page is read by
    visitors, and since migration 202 the viewer's own session reads no
    consultant rows at all unless they are an approved employer — so the
    count under RLS was "how many can *you* see", which for a visitor is
    zero. The number is a fact about the directory, not about the reader,
    and it says nothing about anybody in it.

    Counted by the directory's own rule (search_agents, migration 322): a
    profile that is not hidden, owned by an approved candidate. Counting
    every unhidden profile advertised people the directory does not show —
    a suspended account, one still waiting for approval, an account moved
    to the employer side.
  */
  let consultantCount = 0;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { count, error } = await createAdminClient()
      .from('agent_profiles')
      .select('id, profile:profiles!inner (role, approval_status)', { count: 'exact', head: true })
      .neq('visibility', 'hidden')
      .eq('profile.role', 'candidate')
      .eq('profile.approval_status', 'approved');
    if (!error) consultantCount = count ?? 0;
  } catch {
    /* zero is an honest fallback */
  }

  const viewer = await getViewer();

  return (
    <EmployerLanding
      locale={locale}
      consultantCount={consultantCount}
      signedIn={Boolean(viewer)}
    />
  );
}
