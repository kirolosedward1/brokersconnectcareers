import { Text } from 'react-native';
import { Stack, Tabs, router } from 'expo-router';
import { act, renderRouter } from 'expo-router/testing-library';
import type { Actor } from '@/lib/permissions';
import { routeFromOutside } from '~/lib/links';
import { tabsFor } from '~/lib/tabs';
import { unstable_settings } from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';

/*
  The app's route tree, file for file, with stand-in screens: the real tree's
  shape and the real per-tab first screens (unstable_settings), under a plain
  JS tab navigator in place of the native one. A tab the person does not have
  is left out the way the native bar's `hidden` leaves it out — as a protected
  route. What is tested is where a link lands and where Back goes — the file
  layout's job, not the screens'.
*/
function screen(name: string) {
  function Screen() {
    return <Text>{name}</Text>;
  }
  return Screen;
}

/** Who the tab bar is drawn for in the test at hand. */
let actor: Actor = null;

function TabBar() {
  const tabs = tabsFor(actor);
  return (
    <Tabs>
      <Tabs.Screen name="(home)" />
      <Tabs.Protected guard={tabs.includes('jobs')}>
        <Tabs.Screen name="(jobs)" />
      </Tabs.Protected>
      <Tabs.Protected guard={tabs.includes('companies')}>
        <Tabs.Screen name="(companies)" />
      </Tabs.Protected>
      <Tabs.Protected guard={tabs.includes('applications')}>
        <Tabs.Screen name="(applications)" />
      </Tabs.Protected>
      <Tabs.Protected guard={tabs.includes('saved')}>
        <Tabs.Screen name="(saved)" />
      </Tabs.Protected>
      <Tabs.Protected guard={tabs.includes('listings')}>
        <Tabs.Screen name="(listings)" />
      </Tabs.Protected>
      <Tabs.Protected guard={tabs.includes('applicants')}>
        <Tabs.Screen name="(applicants)" />
      </Tabs.Protected>
      <Tabs.Protected guard={tabs.includes('consultants')}>
        <Tabs.Screen name="(consultants)" />
      </Tabs.Protected>
      <Tabs.Screen name="(account)" />
    </Tabs>
  );
}

const SHARED = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)';

const tree = {
  _layout: { default: () => <Stack screenOptions={{ headerShown: false }} />, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': TabBar,
  [`${SHARED}/_layout`]: { default: () => <Stack />, unstable_settings },
  [`${SHARED}/jobs/[slug]`]: screen('job'),
  [`${SHARED}/jobs/[slug]/apply`]: screen('apply'),
  [`${SHARED}/companies/[slug]`]: screen('company'),
  [`${SHARED}/companies/index`]: screen('directory'),
  [`${SHARED}/notifications`]: screen('notifications'),
  [`${SHARED}/agents/[slug]`]: screen('consultant'),
  '(tabs)/(home)/index': screen('home'),
  '(tabs)/(jobs)/jobs/index': screen('board'),
  '(tabs)/(applications)/dashboard/applications/index': screen('applications'),
  '(tabs)/(saved)/dashboard/saved/index': screen('saved'),
  '(tabs)/(listings)/employer/jobs/index': screen('listings'),
  '(tabs)/(listings,applicants)/employer/jobs/[id]/applicants': screen('pipeline'),
  '(tabs)/(applicants)/employer/applicants/index': screen('inbox'),
  '(tabs)/(consultants)/agents/index': screen('consultants'),
  '(tabs)/(consultants)/employer/talent': screen('shortlist'),
  '(tabs)/(account)/account/index': screen('account'),
  '(tabs)/(account)/account/delete': screen('delete'),
  '(tabs)/(account)/account/profile': screen('profile'),
  '(tabs)/(account)/account/profile/preview': screen('preview'),
  '(tabs)/(account)/employer/company': screen('company'),
  '(tabs)/(account)/employer/billing': screen('billing'),
  '(auth)/sign-in/index': screen('sign-in'),
  '+not-found': screen('missing'),
};

const candidate: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  profile: { role: 'candidate', approval_status: 'approved' },
  company: null,
};

const employer: Actor = {
  userId: '22222222-2222-4222-8222-222222222222',
  profile: { role: 'employer', approval_status: 'approved' },
  company: { id: '33333333-3333-4333-8333-333333333333', verification_status: 'verified' },
};

/** A cold start from a link: the path the app's native intent makes of it, opened fresh. */
const open = (url: string) => renderRouter(tree, { initialUrl: routeFromOutside(url, actor) });

beforeEach(() => {
  actor = null;
});

describe('links from the website', () => {
  it.each([
    ['https://www.brokersconnect.net/', ['(tabs)', '(home)']],
    ['https://www.brokersconnect.net/jobs?track=primary', ['(tabs)', '(jobs)', 'jobs']],
    ['https://www.brokersconnect.net/jobs/sales-a1b2?src=share', ['(tabs)', '(jobs)', 'jobs', '[slug]']],
    // The website's sign-in comes back to the form with this; it asks who is applying itself.
    ['https://www.brokersconnect.net/jobs/sales-a1b2/apply', ['(tabs)', '(jobs)', 'jobs', '[slug]', 'apply']],
    ['https://www.brokersconnect.net/companies', ['(tabs)', '(companies)', 'companies']],
    ['https://www.brokersconnect.net/en/companies/nile', ['(tabs)', '(companies)', 'companies', '[slug]']],
    ['https://www.brokersconnect.net/blog/how-commission-works', ['+not-found']],
  ])('%s opens %j', (url, segments) => {
    expect(open(url).getSegments()).toEqual(segments);
  });

  it('keeps the board filters', () => {
    const result = open('https://www.brokersconnect.net/jobs?track=primary&district=new-cairo');
    expect(result.getSearchParams()).toEqual({ track: 'primary', district: 'new-cairo' });
  });

  it('puts the board under a listing opened from a link', () => {
    const result = open('https://www.brokersconnect.net/jobs/sales-a1b2');
    act(() => router.back());
    expect(result.getPathname()).toBe('/jobs');
    expect(result.getSegments()).toEqual(['(tabs)', '(jobs)', 'jobs']);
  });

  it('puts the directory under a company opened from a link', () => {
    const result = open('https://www.brokersconnect.net/companies/nile');
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(companies)', 'companies']);
  });
});

describe('links to signed-in pages', () => {
  it('asks somebody signed out to sign in, and remembers where they were going', () => {
    const result = open('https://www.brokersconnect.net/dashboard/applications');
    expect(result.getSegments()).toEqual(['(auth)', 'sign-in']);
    expect(result.getSearchParams()).toEqual({ next: '/dashboard/applications' });
  });

  it.each([
    ['https://www.brokersconnect.net/dashboard/applications', ['(tabs)', '(applications)', 'dashboard', 'applications']],
    ['https://www.brokersconnect.net/dashboard/saved', ['(tabs)', '(saved)', 'dashboard', 'saved']],
    ['https://www.brokersconnect.net/dashboard', ['(tabs)', '(home)']],
    ['https://www.brokersconnect.net/dashboard/account', ['(tabs)', '(account)', 'account']],
    ['https://www.brokersconnect.net/dashboard/profile', ['(tabs)', '(account)', 'account', 'profile']],
    ['https://www.brokersconnect.net/notifications', ['(tabs)', '(home)', 'notifications']],
  ])("opens %s in a candidate's own tab", (url, segments) => {
    actor = candidate;
    expect(open(url).getSegments()).toEqual(segments);
  });

  it("sends an employer who follows a candidate's link home, as the website does", () => {
    actor = employer;
    expect(open('https://www.brokersconnect.net/dashboard/applications').getSegments()).toEqual(['(tabs)', '(home)']);
  });

  it('never opens a tab the person does not have', () => {
    actor = employer;
    // An employer has no applications tab; the address is refused before it is opened.
    expect(routeFromOutside('/dashboard/applications', employer)).toBe('/');
  });
});

describe("a candidate's tab bar", () => {
  it('opens a company from a link in Home, since a candidate has no Companies tab', () => {
    actor = candidate;
    const result = open('https://www.brokersconnect.net/companies/nile');
    expect(result.getSegments()).toEqual(['(tabs)', '(home)', 'companies', '[slug]']);
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(home)']);
  });

  it('opens the directory from Home, in Home', () => {
    actor = candidate;
    const result = open('https://www.brokersconnect.net/companies');
    expect(result.getSegments()).toEqual(['(tabs)', '(home)', 'companies']);
  });

  it('opens a bookmarked listing in Saved, with Saved under it', () => {
    actor = candidate;
    const result = open('/dashboard/saved');
    act(() => router.push('/jobs/sales-a1b2'));
    expect(result.getSegments()).toEqual(['(tabs)', '(saved)', 'jobs', '[slug]']);
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(saved)', 'dashboard', 'saved']);
  });
});

describe("an employer's tab bar", () => {
  it.each([
    ['https://www.brokersconnect.net/employer', ['(tabs)', '(home)']],
    ['https://www.brokersconnect.net/employer/jobs', ['(tabs)', '(listings)', 'employer', 'jobs']],
    // Where a new applicant's notification points.
    [
      'https://www.brokersconnect.net/employer/jobs/5b0c7d1e-0000-4000-8000-000000000301/applicants',
      ['(tabs)', '(listings)', 'employer', 'jobs', '[id]', 'applicants'],
    ],
    ['https://www.brokersconnect.net/employer/applicants?stage=new', ['(tabs)', '(applicants)', 'employer', 'applicants']],
    // The company and its billing are kept in the Account tab, with the account under them.
    ['https://www.brokersconnect.net/employer/company', ['(tabs)', '(account)', 'employer', 'company']],
    ['https://www.brokersconnect.net/employer/billing', ['(tabs)', '(account)', 'employer', 'billing']],
    // No board for an employer: a listing opens at home, the board itself is home.
    ['https://www.brokersconnect.net/jobs/sales-a1b2', ['(tabs)', '(home)', 'jobs', '[slug]']],
    ['https://www.brokersconnect.net/jobs?track=primary', ['(tabs)', '(home)']],
    ['https://www.brokersconnect.net/notifications', ['(tabs)', '(home)', 'notifications']],
  ])("opens %s in the employer's own tab", (url, segments) => {
    actor = employer;
    expect(open(url).getSegments()).toEqual(segments);
  });

  it('opens a listing from the console in Listings, with the console under it', () => {
    actor = employer;
    const result = open('/employer/jobs');
    act(() => router.push('/jobs/sales-a1b2'));
    expect(result.getSegments()).toEqual(['(tabs)', '(listings)', 'jobs', '[slug]']);
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(listings)', 'employer', 'jobs']);
  });

  it("opens a listing's applicants from the inbox inside Applicants, with the inbox under it", () => {
    actor = employer;
    const result = open('/employer/applicants');
    act(() => router.push('/employer/jobs/5b0c7d1e-0000-4000-8000-000000000301/applicants'));
    expect(result.getSegments()).toEqual(['(tabs)', '(applicants)', 'employer', 'jobs', '[id]', 'applicants']);
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(applicants)', 'employer', 'applicants']);
  });

  it("sends a candidate who follows an employer's link home", () => {
    actor = candidate;
    expect(open('https://www.brokersconnect.net/employer/jobs').getSegments()).toEqual(['(tabs)', '(home)']);
  });
});

describe('the consultant directory', () => {
  it('opens the directory from a link in Consultants, filters and all', () => {
    actor = employer;
    const result = open('https://www.brokersconnect.net/agents?track=resale');
    expect(result.getSegments()).toEqual(['(tabs)', '(consultants)', 'agents']);
    expect(result.getSearchParams()).toEqual({ track: 'resale' });
  });

  it('puts the directory under a profile opened from a link', () => {
    actor = employer;
    const result = open('https://www.brokersconnect.net/agents/mona-ali');
    expect(result.getSegments()).toEqual(['(tabs)', '(consultants)', 'agents', '[slug]']);
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(consultants)', 'agents']);
  });

  it('opens the shortlist over the directory, and a profile from it', () => {
    actor = employer;
    const result = open('/agents');
    act(() => router.push('/employer/talent'));
    expect(result.getSegments()).toEqual(['(tabs)', '(consultants)', 'employer', 'talent']);
    act(() => router.push('/agents/mona-ali'));
    expect(result.getSegments()).toEqual(['(tabs)', '(consultants)', 'agents', '[slug]']);
    act(() => router.back());
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(consultants)', 'agents']);
  });

  it("opens an applicant's profile inside Applicants, with the inbox under it", () => {
    actor = employer;
    const result = open('/employer/applicants');
    act(() => router.push('/agents/mona-ali'));
    expect(result.getSegments()).toEqual(['(tabs)', '(applicants)', 'agents', '[slug]']);
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(applicants)', 'employer', 'applicants']);
  });

  it('has no directory for an employer still waiting for approval', () => {
    actor = {
      userId: '55555555-5555-4555-8555-555555555555',
      profile: { role: 'employer', approval_status: 'pending' },
      company: null,
    };
    expect(open('https://www.brokersconnect.net/agents').getSegments()).toEqual(['(tabs)', '(home)']);
  });

  it("sends a candidate to their own profile, from where their card's preview opens in Account", () => {
    actor = candidate;
    const result = open('https://www.brokersconnect.net/agents/mona-ali');
    expect(result.getSegments()).toEqual(['(tabs)', '(account)', 'account', 'profile']);
    expect(result.getSearchParams()).toEqual({ notice: 'directory' });
    act(() => router.push('/account/profile/preview'));
    expect(result.getSegments()).toEqual(['(tabs)', '(account)', 'account', 'profile', 'preview']);
  });
});

describe('moving around inside a tab', () => {
  it('opens a listing from home in the home tab, and Back returns home', () => {
    const result = open('/');
    act(() => router.push('/jobs/sales-a1b2'));
    expect(result.getSegments()).toEqual(['(tabs)', '(home)', 'jobs', '[slug]']);

    act(() => router.push('/companies/nile'));
    expect(result.getSegments()).toEqual(['(tabs)', '(home)', 'companies', '[slug]']);

    act(() => router.back());
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(home)']);
  });

  it('opens a company from the board in the board tab', () => {
    const result = open('/jobs');
    act(() => router.push('/jobs/sales-a1b2'));
    act(() => router.push('/companies/nile'));
    expect(result.getSegments()).toEqual(['(tabs)', '(jobs)', 'companies', '[slug]']);
  });

  it('takes "browse by district" on the home screen to the board, filtered', () => {
    const result = open('/');
    act(() => router.navigate({ pathname: '/jobs', params: { district: 'new-cairo' } }));
    expect(result.getSegments()).toEqual(['(tabs)', '(jobs)', 'jobs']);
    expect(result.getSearchParams()).toEqual({ district: 'new-cairo' });
  });

  it("opens the bell's feed in the tab it was rung from, and a listing from an application there too", () => {
    actor = candidate;
    const result = open('/dashboard/applications');
    act(() => router.push('/notifications'));
    expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'notifications']);

    act(() => router.back());
    act(() => router.push('/jobs/sales-a1b2'));
    expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'jobs', '[slug]']);
    act(() => router.back());
    expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']);
  });

  it("switches to the applications tab when a notification points there", () => {
    actor = candidate;
    const result = open('/');
    act(() => router.push('/notifications'));
    act(() => router.navigate('/dashboard/applications'));
    expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']);
  });
});
