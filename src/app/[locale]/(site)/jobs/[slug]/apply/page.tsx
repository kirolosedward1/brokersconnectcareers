import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect, Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { ApplyForm } from '@/components/jobs/apply-form';
import { Button } from '@/components/ui/button';
import { getJobBySlug } from '@/lib/queries/jobs';
import { getViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type Params = { locale: Locale; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'apply' });
  // The apply form is a private step; the job page is the indexable surface.
  return { title: t('submit'), robots: { index: false, follow: true } };
}

export default async function ApplyPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const t = await getTranslations('apply');
  const tJobs = await getTranslations('jobs');

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);

  const isOpen =
    job.status === 'active' && (!job.expires_at || new Date(job.expires_at) > new Date());

  if (!isOpen) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">{tJobs('expired')}</h1>
        <p className="mt-2 text-muted-foreground">{tJobs('expiredBody')}</p>
        <Button asChild className="mt-6">
          <Link href="/jobs">{tJobs('title')}</Link>
        </Button>
      </div>
    );
  }

  const viewer = await getViewer();

  if (!viewer) {
    redirect({ href: { pathname: '/sign-in', query: { next: `/jobs/${slug}/apply` } }, locale });
  }
  if (!viewer!.profile) {
    redirect({ href: { pathname: '/onboarding', query: { next: `/jobs/${slug}/apply` } }, locale });
  }

  const profile = viewer!.profile!;

  // An employer landing here is almost always a mis-click; send them somewhere
  // useful rather than letting them apply to their own board.
  if (profile.role === 'employer') {
    redirect({ href: `/jobs/${slug}`, locale });
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('applications')
    .select('id')
    .eq('job_id', job.id)
    .eq('candidate_id', viewer!.userId)
    .maybeSingle();

  if (existing) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">{t('alreadyApplied')}</h1>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link href="/dashboard/applications">{t('viewApplications')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${slug}`}>{title}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-bold">{t('title', { job: title })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {company} · {t('subtitle')}
        </p>
      </header>

      <ApplyForm
        jobId={job.id}
        jobSlug={slug}
        userId={viewer!.userId}
        defaultName={profile.full_name}
        defaultPhone={profile.whatsapp_phone}
      />
    </div>
  );
}
