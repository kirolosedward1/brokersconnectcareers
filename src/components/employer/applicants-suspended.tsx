import { getTranslations } from 'next-intl/server';
import { Ban } from 'lucide-react';

/**
 * Where a suspended company's applicants would be. The database answers none
 * of them while the company is suspended (migration 349), and an empty list
 * would read as "nobody applied": this says why they are hidden, and that
 * they come back. The applications themselves are kept.
 */
export async function ApplicantsSuspended() {
  const t = await getTranslations('employer');
  return (
    <section className="rounded-xl border border-destructive/30 bg-destructive-muted px-4 py-3.5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Ban className="size-4" aria-hidden />
        {t('applicantsSuspendedTitle')}
      </h2>
      <p className="mt-1 text-sm leading-relaxed">{t('applicantsSuspendedBody')}</p>
    </section>
  );
}
