import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Actor } from '@/lib/permissions';
import { parseActor, rememberActor } from '~/lib/last-actor';
import { appPathFor, inOwnTab, isPublicPath, routeFromOutside, routeInside, webPathToAppPath } from '~/lib/links';
import { takePendingPath } from '~/lib/open-path';
import { tabsFor } from '~/lib/tabs';
import { awaitingOAuthReturn } from '~/features/auth/oauth-return';
import { redirectSystemPath } from '../src/app/+native-intent';

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
const newcomer: Actor = { userId: '44444444-4444-4444-8444-444444444444', profile: null, company: null };
/** An employer still waiting for approval: their console, not yet the directory. */
const waiting: Actor = {
  userId: '55555555-5555-4555-8555-555555555555',
  profile: { role: 'employer', approval_status: 'pending' },
  company: { id: '66666666-6666-4666-8666-666666666666', verification_status: 'unverified' },
};

describe('webPathToAppPath', () => {
  it.each([
    // The website's own addresses, as universal links.
    ['https://www.brokersconnect.net/jobs/sales-consultant-a1b2', '/jobs/sales-consultant-a1b2'],
    ['https://brokersconnect.net/companies/nile-brokers', '/companies/nile-brokers'],
    ['https://www.brokersconnect.net/', '/'],
    ['https://www.brokersconnect.net', '/'],
    // Board filters survive, as the website's parser will read them.
    ['https://www.brokersconnect.net/jobs?track=primary&district=new-cairo,zayed', '/jobs?track=primary&district=new-cairo%2Czayed'],
    // English pages, when English is published, name the same screen.
    ['https://www.brokersconnect.net/en/jobs/abc', '/jobs/abc'],
    ['https://www.brokersconnect.net/en', '/'],
    // …but a path that merely starts with the letters is not a locale.
    ['https://www.brokersconnect.net/english-teachers', '/english-teachers'],
    // The share tag is the website's analytics, not part of the screen.
    ['https://www.brokersconnect.net/jobs/abc?src=share', '/jobs/abc'],
    ['https://www.brokersconnect.net/jobs?q=x&src=share', '/jobs?q=x'],
    // A trailing slash is the same page.
    ['https://www.brokersconnect.net/companies/', '/companies'],
    // Paths as a notification's href carries them.
    ['/notifications', '/notifications'],
    ['/dashboard/applications?status=shortlisted', '/dashboard/applications?status=shortlisted'],
    // The app's own scheme, with two slashes or three.
    ['brokersconnect://jobs/abc', '/jobs/abc'],
    ['brokersconnect:///companies/acme?x=1', '/companies/acme?x=1'],
    ['brokersconnect://', '/'],
    // An email link keeps its token for the screen that verifies it.
    [
      'https://www.brokersconnect.net/auth/confirm?token_hash=pkce_abc123abc123abc1&type=recovery',
      '/auth/confirm?token_hash=pkce_abc123abc123abc1&type=recovery',
    ],
    // Google, back from the authentication browser, if iOS hands it over as a link.
    ['brokersconnect://auth/callback?code=abc', '/auth/callback?code=abc'],
    // Expo Go's own form while the app runs in it: the screen follows "/--".
    ['exp://172.20.10.2:8081/--/jobs/abc', '/jobs/abc'],
    ['exp://172.20.10.2:8081/--/companies/acme?x=1', '/companies/acme?x=1'],
    ['exp://172.20.10.2:8081', '/'],
    ['exp://172.20.10.2:8081/--/', '/'],
  ])('%s → %s', (input, expected) => {
    expect(webPathToAppPath(input)).toBe(expected);
  });

  it.each([
    ['another site', 'https://evil.example/jobs/abc'],
    ['a look-alike host', 'https://www.brokersconnect.net.evil.example/jobs/abc'],
    ['a protocol-relative path', '//evil.example/jobs'],
    ['javascript', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,hi'],
    ['the development client', 'exp+brokers-connect://expo-development-client/?url=http%3A%2F%2F10.0.0.2%3A8081'],
  ])('sends %s home', (_name, input) => {
    expect(webPathToAppPath(input)).toBe('/');
  });
});

describe('inOwnTab', () => {
  const everyone = tabsFor(null);

  it.each([
    ['/jobs', '/(jobs)/jobs'],
    ['/jobs?track=primary', '/(jobs)/jobs?track=primary'],
    ['/jobs/sales-a1b2', '/(jobs)/jobs/sales-a1b2'],
    ['/companies', '/(companies)/companies'],
    ['/companies/nile', '/(companies)/companies/nile'],
    ['/account', '/(account)/account'],
    ['/notifications', '/(home)/notifications'],
    ['/', '/'],
    ['/jobsearch', '/jobsearch'],
    ['/auth/confirm?type=signup', '/auth/confirm?type=signup'],
  ])('%s → %s', (input, expected) => {
    expect(inOwnTab(input, everyone)).toBe(expected);
  });

  it("opens a candidate's applications in their own tab, and nowhere for somebody without it", () => {
    expect(inOwnTab('/dashboard/applications', tabsFor(candidate))).toBe('/(applications)/dashboard/applications');
    expect(inOwnTab('/dashboard/applications', everyone)).toBe('/');
  });

  it("opens an employer's console in their tabs, and a listing at home, since they have no board", () => {
    const tabs = tabsFor(employer);
    expect(inOwnTab('/employer/jobs', tabs)).toBe('/(listings)/employer/jobs');
    expect(inOwnTab('/employer/jobs/abc/edit', tabs)).toBe('/(listings)/employer/jobs/abc/edit');
    expect(inOwnTab('/employer/applicants?stage=new', tabs)).toBe('/(applicants)/employer/applicants?stage=new');
    expect(inOwnTab('/employer/company', tabs)).toBe('/(account)/employer/company');
    expect(inOwnTab('/employer/billing', tabs)).toBe('/(account)/employer/billing');
    expect(inOwnTab('/jobs/sales-a1b2', tabs)).toBe('/(home)/jobs/sales-a1b2');
    expect(inOwnTab('/companies/nile', tabs)).toBe('/(home)/companies/nile');
    // The board is the Jobs tab's own screen: without the tab there is none.
    expect(inOwnTab('/jobs?track=primary', tabs)).toBe('/');
  });

  it('falls back to the next tab a section names when the first is not there', () => {
    expect(inOwnTab('/companies/nile', ['home', 'jobs', 'account'])).toBe('/(home)/companies/nile');
  });
});

describe('appPathFor', () => {
  it.each([
    // The candidate's overview is the home tab, and so is the employer's.
    ['/dashboard', '/'],
    ['/employer', '/'],
    // The website keeps the account under /dashboard; the app has a tab for it.
    ['/dashboard/account', '/account'],
    ['/dashboard/profile?notice=directory', '/account/profile?notice=directory'],
    // Everything else is the same path.
    ['/dashboard/applications', '/dashboard/applications'],
    ['/jobs/a-1', '/jobs/a-1'],
    ['/dashboard/accounts', '/dashboard/accounts'],
  ])('%s → %s', (input, expected) => {
    expect(appPathFor(input)).toBe(expected);
  });
});

describe('who a link is for', () => {
  it('opens public pages for anybody', () => {
    expect(routeFromOutside('https://www.brokersconnect.net/jobs/abc', null)).toBe('/(jobs)/jobs/abc');
    expect(routeFromOutside('https://www.brokersconnect.net/jobs/abc', employer)).toBe('/(home)/jobs/abc');
  });

  it("opens an employer's console for the employer, and nobody else's", () => {
    expect(routeFromOutside('https://www.brokersconnect.net/employer', employer)).toBe('/');
    expect(routeFromOutside('https://www.brokersconnect.net/employer/jobs', employer)).toBe('/(listings)/employer/jobs');
    expect(routeFromOutside('/employer/jobs', candidate)).toBe('/');
    expect(routeFromOutside('/employer/jobs', null)).toBe('/sign-in?next=%2Femployer%2Fjobs');
  });

  it('asks somebody signed out to sign in first, keeping the page as it was asked for', () => {
    expect(routeFromOutside('https://www.brokersconnect.net/dashboard/applications?x=1', null)).toBe(
      '/sign-in?next=%2Fdashboard%2Fapplications%3Fx%3D1',
    );
    expect(routeFromOutside('/notifications', null)).toBe('/sign-in?next=%2Fnotifications');
  });

  it("opens a candidate's pages for the candidate", () => {
    expect(routeFromOutside('https://www.brokersconnect.net/dashboard/applications', candidate)).toBe(
      '/(applications)/dashboard/applications',
    );
    expect(routeFromOutside('https://www.brokersconnect.net/dashboard', candidate)).toBe('/');
    expect(routeFromOutside('https://www.brokersconnect.net/dashboard/account', candidate)).toBe('/(account)/account');
  });

  it("sends anybody else home from a candidate's page, as the website's guard does", () => {
    expect(routeFromOutside('/dashboard/applications', employer)).toBe('/');
    expect(routeFromOutside('/dashboard/applications', newcomer)).toBe('/');
  });

  it('lets anybody signed in open their own account settings and feed', () => {
    expect(routeFromOutside('/dashboard/account', employer)).toBe('/(account)/account');
    expect(routeFromOutside('/notifications', employer)).toBe('/(home)/notifications');
  });

  it('sends a candidate who reaches for the directory to their own profile, with the reason', () => {
    expect(routeFromOutside('/agents/sara', candidate)).toBe('/account/profile?notice=directory');
  });

  it('decides the same inside the app, without naming a tab', () => {
    expect(routeInside('/dashboard/applications', candidate)).toBe('/dashboard/applications');
    expect(routeInside('/dashboard/applications', employer)).toBe('/');
    expect(routeInside('/jobs/abc', null)).toBe('/jobs/abc');
    expect(routeInside('/jobs/abc', employer)).toBe('/jobs/abc');
    // A screen none of their tabs has — the board, for an employer — is home.
    expect(routeInside('/jobs', employer)).toBe('/');
    expect(routeInside('/employer/jobs', employer)).toBe('/employer/jobs');
    expect(routeInside('/dashboard/applications', null)).toBe('/sign-in?next=%2Fdashboard%2Fapplications');
    // What is not a page of ours is not followed.
    expect(routeInside('https://evil.example/jobs', candidate)).toBe('/');
  });
});

describe('the consultant directory', () => {
  it("is a tab for every employer and for nobody else: an approval does not change the bar (and redraw every tab)", () => {
    expect(tabsFor(employer)).toEqual(['home', 'listings', 'applicants', 'consultants', 'account']);
    expect(tabsFor(waiting)).toEqual(tabsFor(employer));
    expect(tabsFor(candidate)).not.toContain('consultants');
    expect(tabsFor(null)).not.toContain('consultants');
  });

  it('opens a link to it, a profile or the shortlist in the Consultants tab', () => {
    expect(routeFromOutside('https://www.brokersconnect.net/agents?track=resale', employer)).toBe(
      '/(consultants)/agents?track=resale',
    );
    expect(routeFromOutside('https://www.brokersconnect.net/en/agents/mona-ali', employer)).toBe(
      '/(consultants)/agents/mona-ali',
    );
    expect(routeFromOutside('https://www.brokersconnect.net/employer/talent', employer)).toBe(
      '/(consultants)/employer/talent',
    );
  });

  it('opens a profile inside the tab the reader is using', () => {
    expect(routeInside('/agents/mona-ali', employer)).toBe('/agents/mona-ali');
  });

  it('sends an employer still waiting for approval to their console, as the website does', () => {
    expect(routeFromOutside('/agents', waiting)).toBe('/');
    expect(routeFromOutside('/agents/mona-ali', waiting)).toBe('/');
    // Their own console's page, which the website opens for any employer: in the
    // Consultants tab, whose screens say who the directory is for until the approval.
    expect(routeFromOutside('/employer/talent', waiting)).toBe('/(consultants)/employer/talent');
    expect(routeInside('/employer/talent', waiting)).toBe('/employer/talent');
  });

  it('asks somebody signed out to sign in first, and sends a candidate to their own profile', () => {
    expect(routeFromOutside('/agents?q=sales', null)).toBe('/sign-in?next=%2Fagents%3Fq%3Dsales');
    expect(routeInside('/agents/mona-ali', candidate)).toBe('/account/profile?notice=directory');
  });
});

describe('the last person on this phone', () => {
  it('reads back what was kept', () => {
    expect(parseActor(JSON.parse(JSON.stringify(candidate)))).toEqual(candidate);
    expect(parseActor(JSON.parse(JSON.stringify(employer)))).toEqual(employer);
    expect(parseActor(newcomer)).toEqual(newcomer);
  });

  it('is nobody when what was kept is not an actor', () => {
    expect(parseActor(null)).toBeNull();
    expect(parseActor('candidate')).toBeNull();
    expect(parseActor({ userId: '' })).toBeNull();
    expect(parseActor({ ...candidate, profile: { role: 'owner', approval_status: 'approved' } })).toBeNull();
    expect(parseActor({ ...employer, company: { id: 7, verification_status: 'verified' } })).toBeNull();
  });
});

describe('a link that opens the app', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    takePendingPath();
  });

  it('opens a public page at once, for anybody', async () => {
    expect(await redirectSystemPath({ path: 'https://www.brokersconnect.net/jobs/abc?src=share', initial: true })).toBe(
      '/(jobs)/jobs/abc',
    );
    expect(takePendingPath()).toBeNull();
  });

  it("opens a signed-in page in the tab of the person the phone remembers", async () => {
    await rememberActor(candidate);
    expect(await redirectSystemPath({ path: 'https://www.brokersconnect.net/dashboard/applications', initial: true })).toBe(
      '/(applications)/dashboard/applications',
    );
  });

  it('holds a signed-in page when the phone remembers nobody, until the session has been read', async () => {
    expect(await redirectSystemPath({ path: 'https://www.brokersconnect.net/dashboard/applications?x=1', initial: false })).toBeNull();
    expect(takePendingPath()).toBe('/dashboard/applications?x=1');
  });

  it('forgets the person on sign-out', async () => {
    await rememberActor(candidate);
    await rememberActor(null);
    expect(await redirectSystemPath({ path: '/notifications', initial: true })).toBeNull();
    expect(takePendingPath()).toBe('/notifications');
  });

  it('leaves Google’s return to the sign-in screen waiting for it, and opens it when none is', async () => {
    const back = 'brokersconnect://auth/callback?code=abc';
    let finish = () => {};
    const signIn = awaitingOAuthReturn(() => new Promise<void>((resolve) => (finish = resolve)));
    // Android hands the browser's return to the app as a link too: the screen waiting has it already.
    expect(await redirectSystemPath({ path: back, initial: false })).toBeNull();
    // Any other link still opens.
    expect(await redirectSystemPath({ path: 'https://www.brokersconnect.net/jobs/abc', initial: false })).toBe('/(jobs)/jobs/abc');
    finish();
    await signIn;
    // Nothing waiting (the app was closed meanwhile): the callback screen finishes the sign-in.
    expect(await redirectSystemPath({ path: back, initial: true })).toBe('/auth/callback?code=abc');
  });

  it('knows which pages are public', () => {
    expect(isPublicPath('https://www.brokersconnect.net/en/jobs')).toBe(true);
    expect(isPublicPath('/auth/confirm?type=signup')).toBe(true);
    expect(isPublicPath('/dashboard')).toBe(false);
    expect(isPublicPath('/notifications')).toBe(false);
    expect(isPublicPath('/employer/jobs')).toBe(false);
  });
});
