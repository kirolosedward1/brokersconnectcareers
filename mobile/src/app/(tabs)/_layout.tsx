import { Tabs } from 'expo-router/js-tabs';
import { useTranslations } from 'use-intl';
import { accountTabIcon, TabBar, tabIcon } from '~/components/navigation/tab-bar';
import { Bookmark, Briefcase, Building2, CircleUserRound, ClipboardList, FileText, House, Inbox, Users } from '~/components/ui/lucide';
import { useConsultantAlerts } from '~/features/directory/alerts';
import { useSession } from '~/lib/session';
import { tabsFor, type TabName } from '~/lib/tabs';

/**
 * The tab bar, by who is using the app (src/lib/tabs.ts, which asks
 * src/lib/permissions.ts). Signed out, it is the public site: home, the board,
 * the companies — and the account, where signing in starts. A candidate has
 * their console instead of the directory: applications and saved. An
 * employer has theirs: listings and applicants, the consultant directory once
 * approved, with the overview at home and the company in the account.
 *
 * A tab left out is a protected route, which takes its screens out of the app
 * for that person altogether; links are routed with the same list (links.ts),
 * so none opens a tab that is not there.
 *
 * Each tab is a group with a stack of its own ((home), (jobs), …); a listing
 * or a company opened from any of them is pushed onto that tab's stack, so the
 * tab bar stays and Back returns to where the reader was. See
 * (home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout.tsx.
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
  const tabs = tabsFor(useSession().actor);
  // A company's kept consultant searches, asked again as the app opens (features/directory/alerts.ts).
  useConsultantAlerts((label, count) => ({
    title: t('app.agentAlerts.notifyTitle', { count }),
    body: label,
  }));
  const has = (tab: TabName) => tabs.includes(tab);

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="(home)"
        options={{ title: t('app.tabs.home'), tabBarIcon: tabIcon({ default: 'house', selected: 'house.fill' }, House) }}
      />

      <Tabs.Protected guard={has('jobs')}>
        <Tabs.Screen
          name="(jobs)"
          options={{ title: t('nav.jobs'), tabBarIcon: tabIcon({ default: 'briefcase', selected: 'briefcase.fill' }, Briefcase) }}
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
