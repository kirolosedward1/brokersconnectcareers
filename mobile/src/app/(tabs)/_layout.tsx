import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslations } from 'use-intl';
import { useTheme } from '~/theme/provider';

/**
 * The tab bar. Signed out, it is the public site: home, the board, the
 * companies — and the account, where signing in starts. The signed-in tabs (a
 * candidate's applications and saved jobs, an employer's listings and
 * applicants) join as their screens are built, each shown or hidden by
 * src/lib/permissions.ts — the website's own rules.
 *
 * Each tab is a group with a stack of its own ((home), (jobs), (companies));
 * a listing or a company opened from any of them is pushed onto that tab's
 * stack, so the tab bar stays and Back returns to where the reader was. See
 * (home,jobs,companies)/_layout.tsx.
 */
export default function TabsLayout() {
  const t = useTranslations();
  const { colors } = useTheme();

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

      <NativeTabs.Trigger name="(companies)">
        <NativeTabs.Trigger.Label>{t('app.tabs.companies')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'building.2', selected: 'building.2.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Label>{t('app.tabs.account')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
