import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslations } from 'use-intl';
import { appDirection } from '~/lib/direction';
import { liquidGlass } from '~/lib/liquid-glass';
import { useSession } from '~/lib/session';
import { tabsFor } from '~/lib/tabs';
import { useTheme } from '~/theme/provider';

/**
 * The tab bar, by who is using the app (src/lib/tabs.ts, which asks
 * src/lib/permissions.ts). Signed out, it is the public site: home, the board,
 * the companies — and the account, where signing in starts. A candidate has
 * their console instead of the directory: applications and saved. An
 * employer has theirs: listings and applicants, the consultant directory once
 * approved, with the overview at home and the company in the account.
 *
 * A tab left out is `hidden`, which takes its screens out of the app for that
 * person altogether; links are routed with the same list (links.ts), so none
 * opens a tab that is not there.
 *
 * Each tab is a group with a stack of its own ((home), (jobs), …); a listing
 * or a company opened from any of them is pushed onto that tab's stack, so the
 * tab bar stays and Back returns to where the reader was. See
 * (home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout.tsx.
 *
 * Each icon twice: an SF Symbol for iOS and a Material symbol for Android,
 * which has no SF Symbols and drew the tabs with none.
 *
 * The bar runs the way the screens do. iOS lays a tab bar out by the language
 * the app is running in, not by React Native's direction: on an iPhone set to
 * English, and in Expo Go, which lays it out in Expo Go's own language, the
 * bar ran left to right, Home on the left, under screens running right to
 * left. The app's direction is given to it (src/lib/direction.ts), and
 * through it to the screens inside.
 *
 * On iOS 26 the bar shrinks out of the way as the reader scrolls down a list,
 * to the open tab alone, and comes back as they scroll up — the way Instagram's
 * does. Earlier iOS, and Android, keep it as it is.
 */
export default function TabsLayout() {
  const t = useTranslations();
  const { colors } = useTheme();
  const tabs = tabsFor(useSession().actor);

  return (
    // Android: every tab says its name, not only the one open (Material hides the rest past three tabs).
    <NativeTabs
      tintColor={colors.primary}
      labelVisibilityMode="labeled"
      minimizeBehavior={liquidGlass() ? 'onScrollDown' : undefined}
      unstable_nativeProps={{ direction: appDirection }}
    >
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>{t('app.tabs.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(jobs)" hidden={!tabs.includes('jobs')}>
        <NativeTabs.Trigger.Label>{t('nav.jobs')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'briefcase', selected: 'briefcase.fill' }} md="work" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(companies)" hidden={!tabs.includes('companies')}>
        <NativeTabs.Trigger.Label>{t('app.tabs.companies')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'building.2', selected: 'building.2.fill' }} md="apartment" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(applications)" hidden={!tabs.includes('applications')}>
        <NativeTabs.Trigger.Label>{t('dashboard.applications')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'doc.text', selected: 'doc.text.fill' }} md="description" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(saved)" hidden={!tabs.includes('saved')}>
        <NativeTabs.Trigger.Label>{t('app.tabs.saved')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bookmark', selected: 'bookmark.fill' }} md="bookmark" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(listings)" hidden={!tabs.includes('listings')}>
        <NativeTabs.Trigger.Label>{t('employer.jobs')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }} md="list_alt" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(applicants)" hidden={!tabs.includes('applicants')}>
        <NativeTabs.Trigger.Label>{t('app.tabs.applicants')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'tray', selected: 'tray.fill' }} md="inbox" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(consultants)" hidden={!tabs.includes('consultants')}>
        <NativeTabs.Trigger.Label>{t('app.tabs.consultants')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Label>{t('app.tabs.account')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
