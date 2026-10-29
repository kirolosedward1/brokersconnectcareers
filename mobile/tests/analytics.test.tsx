import { act, renderHook } from '@testing-library/react-native';
import { resetAnalyticsForTests, setAnalyticsOptOut, setAnalyticsSink, track } from '~/lib/analytics';
import { holdOnboarding, useOnboardingHeld } from '~/lib/onboarding-hold';

/*
  The funnel events the app records — only the website's vocabulary, only
  where there is somewhere to send them, never for somebody who said no —
  and the hold a screen puts on the session gate while it makes an account.
*/

afterEach(() => resetAnalyticsForTests());

describe('an event', () => {
  it('goes nowhere until a sink is set', () => {
    expect(() => track('apply_clicked', { role: 'candidate' })).not.toThrow();
  });

  it('goes as the vocabulary allows it, and not at all when it says otherwise', () => {
    const sink = jest.fn();
    setAnalyticsSink(sink);
    track('apply_clicked', { role: 'candidate' });
    track('profile_completeness_reached', { percent: '60' });
    track('applicant_opened', { first: true });
    expect(sink.mock.calls).toEqual([
      ['apply_clicked', { role: 'candidate' }],
      ['profile_completeness_reached', { percent: '60' }],
      ['applicant_opened', { first: true }],
    ]);

    sink.mockClear();
    // A value outside the vocabulary, a property it does not name: the whole event is refused.
    track('apply_clicked', { role: 'someone' as never });
    track('apply_clicked', { role: 'candidate', email: 'sara@example.com' } as never);
    expect(sink).not.toHaveBeenCalled();
  });

  it('is never sent for somebody who turned analytics off on this phone', () => {
    const sink = jest.fn();
    setAnalyticsSink(sink);
    setAnalyticsOptOut(true);
    track('apply_clicked', { role: 'candidate' });
    expect(sink).not.toHaveBeenCalled();
    setAnalyticsOptOut(false);
    track('apply_clicked', { role: 'candidate' });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('never takes the screen down with a sink that fails', () => {
    setAnalyticsSink(() => {
      throw new Error('offline');
    });
    expect(() => track('apply_clicked', { role: 'visitor' })).not.toThrow();
  });
});

describe('the hold on onboarding', () => {
  it('lasts while any screen holds it, and is let go once however often its release is called', () => {
    const { result } = renderHook(() => useOnboardingHeld());
    expect(result.current).toBe(false);
    let first = () => {};
    let second = () => {};
    act(() => {
      first = holdOnboarding();
      second = holdOnboarding();
    });
    expect(result.current).toBe(true);
    act(() => {
      first();
      first();
    });
    expect(result.current).toBe(true);
    act(() => second());
    expect(result.current).toBe(false);
  });
});
