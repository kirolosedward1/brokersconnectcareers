import { useLocale, useTranslations } from 'use-intl';
import type { JobListItem } from '@/lib/job-list';
import { localized } from '@/lib/locale';
import type { ReminderWords } from './reminders';

/**
 * What a reminder says on the lock screen, in the language the app speaks
 * when it is set: that the listing closes tomorrow (or today, for one set on
 * its last day), and which listing, at which company.
 */
export function useReminderWords() {
  const t = useTranslations('app.saved.remind');
  const locale = useLocale();
  return (job: Pick<JobListItem, 'title_ar' | 'title_en' | 'company'>): ReminderWords =>
    (day) => ({
      title: t('notifyTitle', { day }),
      body: t('notifyBody', {
        job: localized(locale, job.title_ar, job.title_en),
        company: localized(locale, job.company.name_ar, job.company.name_en),
      }),
    });
}
