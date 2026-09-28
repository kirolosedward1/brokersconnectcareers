import { landingFromRedirect } from '@/lib/auth/confirm-link';
import { allowCaptchaLoad, captchaUrl, parseCaptchaMessage } from '~/features/auth/captcha';
import {
  appPathFor,
  confirmationPath,
  intentFromParams,
  intentFromPath,
  intentParams,
  NO_INTENT,
} from '~/features/auth/intent';
import { webPathToAppPath } from '~/lib/links';

const SITE = 'https://www.brokersconnect.net';

describe('the confirmation email a sign-up asks for', () => {
  it("is the website's shape to the character", () => {
    // What src/components/auth/auth-form.tsx builds for the same door and destination.
    expect(confirmationPath({ role: null, next: null })).toBe('/auth/callback?next=%2Fonboarding%3Fconfirmed%3D1');
    expect(confirmationPath({ role: 'employer', next: '/jobs/sales-a1b2' })).toBe(
      '/auth/callback?next=%2Fonboarding%3Frole%3Demployer%26confirmed%3D1%26next%3D%252Fjobs%252Fsales-a1b2',
    );
  });

  it('comes back as the same intent, however the link is read', () => {
    const redirect = `${SITE}${confirmationPath({ role: 'employer', next: '/jobs/sales-a1b2' })}`;
    const expected = { next: '/jobs/sales-a1b2', role: 'employer', confirmed: true };

    // Read by the website's rule from the raw redirect…
    expect(intentFromPath(landingFromRedirect(redirect, SITE))).toEqual(expected);

    // …and from what the app's router hands the screen: the universal link as
    // +native-intent rewrites it, then its parameters decoded once more.
    const link = `${SITE}/auth/confirm?token_hash=pkce_abcdef0123456789&type=signup&redirect_to=${redirect}`;
    const appPath = webPathToAppPath(link);
    const redirectTo = new URL(appPath, 'https://app.invalid').searchParams.get('redirect_to');
    expect(intentFromPath(landingFromRedirect(redirectTo, SITE))).toEqual(expected);
  });
});

describe('an intent', () => {
  it('is read from route parameters, keeping only what is safe', () => {
    expect(intentFromParams({ next: '/jobs/a-1', role: 'candidate', confirmed: '1' })).toEqual({
      next: '/jobs/a-1',
      role: 'candidate',
      confirmed: true,
    });
    expect(intentFromParams({ next: 'https://evil.example', role: 'admin' })).toEqual(NO_INTENT);
    expect(intentFromParams({ next: '//evil.example' }).next).toBeNull();
  });

  it('goes back into parameters without empty ones', () => {
    expect(intentParams(NO_INTENT)).toEqual({});
    expect(intentParams({ next: '/jobs', role: 'employer', confirmed: true })).toEqual({
      next: '/jobs',
      role: 'employer',
      confirmed: '1',
    });
  });

  it('treats a plain destination as one, and onboarding as the wrapper it is', () => {
    expect(intentFromPath('/companies/nile-brokers')).toEqual({ next: '/companies/nile-brokers', role: null, confirmed: false });
    expect(intentFromPath('/onboarding?confirmed=1')).toEqual({ next: null, role: null, confirmed: true });
    expect(intentFromPath(null)).toEqual(NO_INTENT);
  });

  it("opens the website's account settings as the Account tab", () => {
    expect(appPathFor('/dashboard/account')).toBe('/account');
    expect(appPathFor('/jobs/a-1')).toBe('/jobs/a-1');
  });
});

describe('the captcha page', () => {
  const page = captchaUrl(SITE, 'sign-in', 'dark');

  it('is the website page for the action, in the theme', () => {
    expect(page).toBe(`${SITE}/api/mobile/v1/captcha?action=sign-in&theme=dark`);
  });

  it('is understood only in the words it speaks', () => {
    expect(parseCaptchaMessage('{"type":"token","token":"0.abc"}')).toEqual({ type: 'token', token: '0.abc' });
    expect(parseCaptchaMessage('{"type":"interactive"}')).toEqual({ type: 'interactive' });
    expect(parseCaptchaMessage('{"type":"error","code":"110200"}')).toEqual({ type: 'error', code: '110200' });
    expect(parseCaptchaMessage('{"type":"token","token":""}')).toBeNull();
    expect(parseCaptchaMessage(`{"type":"token","token":"${'x'.repeat(5000)}"}`)).toBeNull();
    expect(parseCaptchaMessage('{"type":"navigate","to":"https://evil.example"}')).toBeNull();
    expect(parseCaptchaMessage('not json')).toBeNull();
  });

  it("loads only itself, and Cloudflare's frames inside it", () => {
    expect(allowCaptchaLoad({ url: page, isTopFrame: true }, page)).toBe(true);
    expect(allowCaptchaLoad({ url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x', isTopFrame: false }, page)).toBe(true);
    expect(allowCaptchaLoad({ url: 'about:blank', isTopFrame: false }, page)).toBe(true);
    expect(allowCaptchaLoad({ url: 'https://www.cloudflare.com/privacypolicy/', isTopFrame: true }, page)).toBe(false);
    expect(allowCaptchaLoad({ url: 'https://evil.example/frame', isTopFrame: false }, page)).toBe(false);
    expect(allowCaptchaLoad({ url: `${SITE}/jobs`, isTopFrame: true }, page)).toBe(false);
  });
});
