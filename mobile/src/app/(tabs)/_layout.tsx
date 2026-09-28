import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslations } from 'use-intl';
import { useSession } from '~/lib/session';
import { tabsFor } from '~/lib/tabs';
import { useTheme } from '~/theme/provider';

/**
 * The tab bar, by who is using the app (src/lib/tabs.ts, which asks
 * src/lib/permissions.ts). Signed out, it is the public site: home, the board,
 * the companies — and the account, where signing in starts. A candidate adds
 * their applications. An employer's listings and applicants join when their
 * screens are built.
 *
 * A tab left out is `hidden`, which takes its screens out of the app for that
 * person altogether; links are routed with the same list (links.ts), so none
 * opens a tab that is not there.
 *
 * Each tab is a group with a stack of its own ((home), (jobs), …); a listing
 * or a company opened from any of them is pushed onto that tab's stack, so the
 * tab bar stays and Back returns to where the reader was. See
 * (home,jobs,companies,applications,account)/_layout.tsx.
 */
export default function TabsLayout() {
  const t = useTranslations();
  const { colors } = useTheme();
  const tabs = tabsFor(useSession().actor);

  return (
    <NativeTabs tintColor={colors.primary}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>{t('app.tabs.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(jobs)">
        <NativeTabs.Trigger.Label>{t('nav.jobs')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'briefcase', selected: 'briefcase.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(companies)" hidden={!tabs.includes('companies')}>
        <NativeTabs.Trigger.Label>{t('app.tabs.companies')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'building.2', selected: 'building.2.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(applications)" hidden={!tabs.includes('applications')}>
        <NativeTabs.Trigger.Label>{t('dashboard.applications')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'doc.text', selected: 'doc.text.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Label>{t('app.tabs.account')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
