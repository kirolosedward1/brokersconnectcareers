import { Text } from 'react-native';
import { Stack, Tabs, router } from 'expo-router';
import { act, renderRouter } from 'expo-router/testing-library';
import { unstable_settings } from '../src/app/(tabs)/(home,jobs,companies)/_layout';
import { redirectSystemPath } from '../src/app/+native-intent';

/*
  The app's route tree, file for file, with stand-in screens: the real tree's
  shape and the real per-tab first screens (unstable_settings), under a plain
  JS tab navigator in place of the native one. What is tested is where a link
  lands and where Back goes — the file layout's job, not the screens'.
*/
function screen(name: string) {
  function Screen() {
    return <Text>{name}</Text>;
  }
  return Screen;
}

const tree = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/(home,jobs,companies)/_layout': { default: () => <Stack />, unstable_settings },
  '(tabs)/(home,jobs,companies)/jobs/[slug]': screen('job'),
  '(tabs)/(home,jobs,companies)/companies/[slug]': screen('company'),
  '(tabs)/(home)/index': screen('home'),
  '(tabs)/(jobs)/jobs/index': screen('board'),
  '(tabs)/(companies)/companies/index': screen('directory'),
  '+not-found': screen('missing'),
};

/** A cold start from a link: the path the app's native intent makes of it, opened fresh. */
const open = (url: string) => renderRouter(tree, { initialUrl: redirectSystemPath({ path: url, initial: true }) });

describe('links from the website', () => {
  it.each([
    ['https://www.brokersconnect.net/', ['(tabs)', '(home)']],
    ['https://www.brokersconnect.net/jobs?track=primary', ['(tabs)', '(jobs)', 'jobs']],
    ['https://www.brokersconnect.net/jobs/sales-a1b2?src=share', ['(tabs)', '(jobs)', 'jobs', '[slug]']],
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
});
