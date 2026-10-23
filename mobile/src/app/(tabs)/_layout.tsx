import { useEffect } from 'react';
import { router, useSegments } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslations } from 'use-intl';
import { accountTabIcon, TabBar, tabIcon } from '~/components/navigation/tab-bar';
import { Bookmark, Briefcase, Building2, CircleUserRound, ClipboardList, FileText, House, Inbox, ShieldCheck, Users } from '~/components/ui/lucide';
import { useAdminOverview, waitingCount } from '~/features/admin/queries';
import { useConsultantAlerts } from '~/features/directory/alerts';
import { useNewJobsBadge } from '~/features/jobs/new-since';
import { markupTags } from '~/i18n/rich';
import { useSession } from '~/lib/session';
import { startPath, tabsFor, type TabName } from '~/lib/tabs';

/**
 * Whether this tab group is one this person has a screen in. A shared group
 * names every tab it serves (`(home,jobs,…,admin)`); one of those names is
 * enough. A group that is not a tab — still resolving, a sheet — is left alone.
 */
function groupIsOpen(group: string | undefined, tabs: readonly TabName[]): boolean {
  if (!group?.startsWith('(') || !group.endsWith(')')) return true;
  const names = group.slice(1, -1).split(',');
  return names.some((name) => (tabs as readonly string[]).includes(name));
}

/**
 * The tab bar, by who is using the app (src/lib/tabs.ts, which asks
 * src/lib/permissions.ts). Signed out, it is the public site: home, the board,
 * the companies — and the account, where signing in starts. A candidate has
 * their console instead of the directory: applications and saved. An
 * employer has theirs: listings and applicants, the consultant directory once
 * approved, with the overview at home and the company in the account. An
 * admin has two tabs: the console first, so the app opens on it, then the
 * account. They have no Home, board, companies or company console in the
 * bar, whether or not they run a company. The console's badge is the things
 * waiting on a decision. A listing, a company, the directory or the shortlist
 * opened from the console is pushed onto the Admin tab's stack.
 *
 * A tab left out is a protected route, which takes its screens out of the app
 * for that person altogether; links are routed with the same list (links.ts),
 * so none opens a tab that is not there.
 *
 * Each tab is a group with a stack of its own ((home), (jobs), …); a listing
 * or a company opened from any of them is pushed onto that tab's stack, so the
 * tab bar stays and Back returns to where the reader was. See
 * (home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout.tsx.
 * Pressing the open tab again takes its stack back to its first screen, and
 * that screen's list back to its top.
 *
 * The bar is the app's own (src/components/navigation/tab-bar.tsx), not
 * iOS's: iOS 26's shrinks to the open tab alone as a list scrolls, and this
 * one keeps every tab, growing smaller and dropping their names instead. It
 * is laid out in the app's direction (src/lib/direction.ts) like everything
 * else, so in Arabic Home is at the right — iOS's own bar ran left to right
 * on an iPhone set to English and in Expo Go.
 */
export default function TabsLayout() {
  const t = useTranslations();
  const { actor } = useSession();
  const tabs = tabsFor(actor);
  // The typed route only names this layout's own segment; at run time the list
  // is the whole path, and the next one is the open tab.
  const segments = useSegments() as readonly string[];
  // A sign-in closes onto whatever was underneath, which is Home. An admin
  // has no Home tab: a group that is not theirs opens the console. The first
  // mount already starts there (initialRouteName); this covers the bar
  // changing under a screen that was already open.
  useEffect(() => {
    if (segments[0] !== '(tabs)') return;
    if (groupIsOpen(segments[1], tabs)) return;
    router.replace(startPath(actor));
  }, [actor, segments, tabs]);
  // A company's kept consultant searches, asked again as the app opens (features/directory/alerts.ts).
  useConsultantAlerts((label, count) => ({
    title: t('app.agentAlerts.notifyTitle', { count }),
    body: label,
  }));
  const has = (tab: TabName) => tabs.includes(tab);
  // Listings published since the board was last looked at (features/jobs/new-since.ts).
  const newJobs = useNewJobsBadge();
  // What waits on a moderator: read only for an admin the console opens for (features/admin/queries.ts).
  const waiting = waitingCount(useAdminOverview().data);

  return (
    <Tabs
      initialRouteName={tabs[0] === 'admin' ? '(admin)' : '(home)'}
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Protected guard={has('home')}>
        <Tabs.Screen
          name="(home)"
          options={{ title: t('app.tabs.home'), tabBarIcon: tabIcon({ default: 'house', selected: 'house.fill' }, House) }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={has('jobs')}>
        <Tabs.Screen
          name="(jobs)"
          options={{
            title: t('nav.jobs'),
            tabBarIcon: tabIcon({ default: 'briefcase', selected: 'briefcase.fill' }, Briefcase),
            tabBarBadge: newJobs || undefined,
            tabBarAccessibilityLabel: newJobs ? t.markup('app.tabs.jobsNew', { name: t('nav.jobs'), count: newJobs, ...markupTags }) : undefined,
          }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={has('companies')}>
        <Tabs.Screen
          name="(companies)"
          options={{
            title: t('app.tabs.companies'),
            tabBarIcon: tabIcon({ default: 'building.2', selected: 'building.2.fill' }, Building2),
          }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={has('applications')}>
        <Tabs.Screen
          name="(applications)"
          options={{
            title: t('dashboard.applications'),
            tabBarIcon: tabIcon({ default: 'doc.text', selected: 'doc.text.fill' }, FileText),
          }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={has('saved')}>
        <Tabs.Screen
          name="(saved)"
          options={{ title: t('app.tabs.saved'), tabBarIcon: tabIcon({ default: 'bookmark', selected: 'bookmark.fill' }, Bookmark) }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={has('listings')}>
        <Tabs.Screen
          name="(listings)"
          options={{
            title: t('employer.jobs'),
            tabBarIcon: tabIcon({ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }, ClipboardList),
          }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={has('applicants')}>
        <Tabs.Screen
          name="(applicants)"
          options={{ title: t('app.tabs.applicants'), tabBarIcon: tabIcon({ default: 'tray', selected: 'tray.fill' }, Inbox) }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={has('consultants')}>
        <Tabs.Screen
          name="(consultants)"
          options={{
            title: t('app.tabs.consultants'),
            tabBarIcon: tabIcon({ default: 'person.2', selected: 'person.2.fill' }, Users),
          }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={has('admin')}>
        <Tabs.Screen
          name="(admin)"
          options={{
            title: t('admin.title'),
            tabBarIcon: tabIcon({ default: 'checkmark.shield', selected: 'checkmark.shield.fill' }, ShieldCheck),
            tabBarBadge: waiting || undefined,
            tabBarAccessibilityLabel: waiting
              ? t.markup('app.admin.tabWaiting', { name: t('admin.title'), count: waiting, ...markupTags })
              : undefined,
          }}
        />
      </Tabs.Protected>

      <Tabs.Screen
        name="(account)"
        options={{
          title: t('app.tabs.account'),
          // The reader's own photo, once they have put one on their account.
          tabBarIcon: accountTabIcon({ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }, CircleUserRound),
        }}
      />
    </Tabs>
  );
}
