import { useEffect } from 'react';
import * as QuickActions from 'expo-quick-actions';
import { useLocale, useTranslations } from 'use-intl';
import { isCandidate, isEmployer, type Actor } from '@/lib/permissions';
import { openWhenReady } from '~/lib/open-path';
import { useSession } from '~/lib/session';

type Translate = (key: 'searchJobs' | 'applications' | 'saved' | 'postJob' | 'newApplicants' | 'listings' | 'companies') => string;

/**
 * What holding the app's icon on the home screen offers, by who is signed in:
 * a candidate's search, applications and saved jobs; an employer's new
 * listing, new applicants and listings; somebody signed out, the board and
 * the companies. Each is a website path, opened as any link is (PendingPath).
 */
export function shortcutsFor(actor: Actor, t: Translate): QuickActions.Action[] {
  if (isCandidate(actor)) {
    return [
      { id: 'search', title: t('searchJobs'), icon: 'symbol:magnifyingglass', params: { href: '/jobs' } },
      { id: 'applications', title: t('applications'), icon: 'symbol:doc.text', params: { href: '/dashboard/applications' } },
      { id: 'saved', title: t('saved'), icon: 'symbol:bookmark', params: { href: '/dashboard/saved' } },
    ];
  }
  if (isEmployer(actor)) {
    return [
      { id: 'post', title: t('postJob'), icon: 'symbol:plus.circle', params: { href: '/employer/jobs/new' } },
      { id: 'applicants', title: t('newApplicants'), icon: 'symbol:person.2', params: { href: '/employer/applicants?stage=new' } },
      { id: 'listings', title: t('listings'), icon: 'symbol:list.bullet.rectangle', params: { href: '/employer/jobs' } },
    ];
  }
  return [
    { id: 'search', title: t('searchJobs'), icon: 'symbol:magnifyingglass', params: { href: '/jobs' } },
    { id: 'companies', title: t('companies'), icon: 'symbol:building.2', params: { href: '/companies' } },
  ];
}

/** The shortcut the app was opened from, taken once. */
let openedFrom: QuickActions.Action | undefined = QuickActions.initial;

function open(action: QuickActions.Action | undefined) {
  const href = action?.params?.href;
  if (typeof href === 'string' && href.startsWith('/')) openWhenReady(href);
}

/**
 * Keeps the home-screen shortcuts in step with who is signed in, and opens
 * the one pressed — at launch or while the app runs. Only in a build of the
 * app: in Expo Go the icon is Expo Go's, and this does nothing.
 */
export function HomeShortcuts() {
  const t = useTranslations('app.shortcuts');
  const locale = useLocale();
  const { actor, settled } = useSession();
  const kind = isCandidate(actor) ? 'candidate' : isEmployer(actor) ? 'employer' : 'other';

  useEffect(() => {
    if (!settled) return;
    QuickActions.setItems(shortcutsFor(actor, t)).catch(() => {});
    // Redone when the kind of account or the language changes; the rest of `actor` does not change the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, kind, locale]);

  useEffect(() => {
    open(openedFrom);
    openedFrom = undefined;
    const subscription = QuickActions.addListener(open);
    return () => subscription.remove();
  }, []);

  return null;
}
