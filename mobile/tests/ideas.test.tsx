import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { timelineSteps } from '~/components/applications/timeline';
import { fillReply } from '~/components/employer/saved-replies';
import { ringShare } from '~/components/profile/completeness-ring';
import { SwipeRow } from '~/components/ui/swipe-row';
import { checkAgentSearches, saveAgentSearch, savedAgentSearches } from '~/features/directory/alerts';
import { matchFor, matchPercent } from '~/features/jobs/match';
import { recentJobs, type ViewedJob } from '~/features/jobs/recent';
import { getJson } from '~/lib/api';
import { createLocalList } from '~/lib/local-list';
import { ThemeProvider } from '~/theme/provider';

/*
  The owner's list of ideas, one by one where they are logic of their own:
  the match on a card, an application's steps, the ring's share, the list a
  phone keeps, saved replies, a swiped row, and a company's consultant
  searches asked again.
*/

jest.mock('~/lib/api', () => ({ ...jest.requireActual('~/lib/api'), getJson: jest.fn() }));

beforeEach(async () => {
  await AsyncStorage.clear();
  recentJobs.resetForTests();
  savedAgentSearches.resetForTests();
  jest.mocked(getJson).mockReset();
});

describe('a match on a job card', () => {
  const job = { track: 'resale', district_id: 7, experience_band: 'mid_3_5' } as const;

  it('is the share of what the profile could match, by the website\'s own scoring', () => {
    expect(matchPercent(5)).toBe(100);
    expect(matchFor(job, { tracks: ['resale'], district_ids: [7], years_experience: 4 })?.percent).toBe(100);
    expect(matchFor(job, { tracks: ['resale'], district_ids: [1], years_experience: 0 })?.percent).toBe(40);
  });

  it('says nothing for a profile that names no track or district, or a listing that matches nothing', () => {
    expect(matchFor(job, null)).toBeNull();
    expect(matchFor(job, { tracks: [], district_ids: [], years_experience: 4 })).toBeNull();
    expect(matchFor(job, { tracks: ['primary'], district_ids: [1], years_experience: 0 })).toBeNull();
  });
});

describe("an application's steps", () => {
  const at = (status: Parameters<typeof timelineSteps>[0]['status'], viewed: string | null = null) =>
    timelineSteps({ status, created_at: '2026-10-01T10:00:00Z', employer_viewed_at: viewed }).map((step) => step.state);

  it('waits on the company until it opens the application', () => {
    expect(at('new')).toEqual(['done', 'current', 'ahead', 'ahead']);
    expect(at('new', '2026-10-02T10:00:00Z')).toEqual(['done', 'done', 'current', 'ahead']);
  });

  it('counts a move past "new" as seen, and ends a rejection where it happened', () => {
    expect(at('shortlisted')).toEqual(['done', 'done', 'done', 'current']);
    expect(at('interview')).toEqual(['done', 'done', 'done', 'current']);
    expect(at('hired')).toEqual(['done', 'done', 'done', 'done']);
    expect(at('rejected')).toEqual(['done', 'done', 'ahead', 'stopped']);
  });
});

it('draws the completeness ring no further than the whole way round', () => {
  expect(ringShare(70)).toBe(0.7);
  expect(ringShare(140)).toBe(1);
  expect(ringShare(-5)).toBe(0);
});

describe('a list kept on the phone', () => {
  const list = createLocalList<{ id: string; n: number }>('test.list', {
    max: 3,
    idOf: (item) => item.id,
    valid: (item): item is { id: string; n: number } => typeof (item as { id?: unknown }).id === 'string',
  });

  it('keeps the newest first, once each, up to its length, apart for each person', async () => {
    list.resetForTests();
    for (const id of ['a', 'b', 'a', 'c', 'd']) list.add('sara', { id, n: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await list.read('sara')).map((item) => item.id)).toEqual(['d', 'c', 'a']);
    expect(await list.read('omar')).toEqual([]);
    // Written down, and read back by the next launch.
    list.resetForTests();
    expect((await list.read('sara')).map((item) => item.id)).toEqual(['d', 'c', 'a']);
  });

  it('keeps the listings looked at lately under the person who looked', async () => {
    const viewed: ViewedJob = {
      id: 'j1',
      slug: 'sales-lead',
      title_ar: 'مدير مبيعات',
      title_en: null,
      company: { id: 'c1', slug: 'nile', name_ar: 'نايل', name_en: null, logo_url: null },
      district: { name_ar: 'التجمع', name_en: null },
    };
    recentJobs.add('sara', viewed);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await recentJobs.read('sara')).toEqual([viewed]);
    expect(await recentJobs.read('anon')).toEqual([]);
  });
});

it("puts the applicant's name and the job into a saved reply", () => {
  expect(fillReply('أهلاً {name}، بخصوص {job} و{name}', { name: 'سارة', job: 'مدير مبيعات' })).toBe('أهلاً سارة، بخصوص مدير مبيعات وسارة');
});

describe('a row swiped aside', () => {
  function draw(onShortlist: jest.Mock, onReject: jest.Mock) {
    render(
      <ThemeProvider>
        <SwipeRow
          left={{ label: 'رفض', icon: null, color: '#B00', onPress: onReject }}
          right={{ label: 'قائمة مختصرة', icon: null, color: '#0B0', onPress: onShortlist }}
        >
          <Text>المتقدم</Text>
        </SwipeRow>
      </ThemeProvider>,
    );
  }

  it('offers both moves to VoiceOver, which cannot swipe', () => {
    const shortlist = jest.fn();
    const reject = jest.fn();
    draw(shortlist, reject);
    const row = screen.UNSAFE_root.findAll((node) => Array.isArray(node.props.accessibilityActions))[0];
    expect(row.props.accessibilityActions.map((action: { label: string }) => action.label)).toEqual(['رفض', 'قائمة مختصرة']);
    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'right' } });
    expect(shortlist).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
  });

  it('does not act on a tap of an action it has not been swiped open to show', () => {
    const shortlist = jest.fn();
    draw(shortlist, jest.fn());
    fireEvent.press(screen.getByTestId('swipe-right', { includeHiddenElements: true }));
    expect(shortlist).not.toHaveBeenCalled();
  });
});

describe("a company's consultant searches", () => {
  const page = (ids: string[]) => ({ agents: ids.map((id) => ({ id })), total: ids.length, page: 1, pageCount: 1 });
  const words = (label: string, count: number) => ({ title: `${count} new`, body: label });

  it('counts the consultants a kept search has that were not there, and says so once', async () => {
    jest.mocked(getJson).mockResolvedValueOnce(page(['a1', 'a2']) as never);
    await saveAgentSearch('company-admin', 'track=resale', 'ريسيل');
    await new Promise((resolve) => setTimeout(resolve, 0));
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Notifications.scheduleNotificationAsync).mockClear();

    jest.mocked(getJson).mockResolvedValue(page(['a3', 'a1', 'a2']) as never);
    expect(await checkAgentSearches('company-admin', words)).toBe(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: '1 new', body: 'ريسيل', data: { localHref: '/agents?track=resale' } },
      trigger: null,
    });
    // The same news is not told twice.
    expect(await checkAgentSearches('company-admin', words)).toBe(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('asks nothing of the phone it has not been let to notify', async () => {
    jest.mocked(getJson).mockResolvedValueOnce(page([]) as never);
    await saveAgentSearch('company-admin', 'district=new-cairo', 'التجمع');
    await new Promise((resolve) => setTimeout(resolve, 0));
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
    jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
    jest.mocked(getJson).mockResolvedValue(page(['a9']) as never);
    expect(await checkAgentSearches('company-admin', words)).toBe(1);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
