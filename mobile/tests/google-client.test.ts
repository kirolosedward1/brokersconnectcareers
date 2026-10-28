import { googleClientId, googleIdTokenRedirect, iosGoogleUrlScheme } from '~/features/auth/google-client';

const IOS = '100000000000-iosclienttest.apps.googleusercontent.com';
const ANDROID = '100000000000-androidclienttest.apps.googleusercontent.com';

describe('a Google client id', () => {
  it('accepts one and refuses anything else', () => {
    expect(googleClientId(IOS)).toBe(IOS);
    expect(googleClientId('')).toBeNull();
    expect(googleClientId(undefined)).toBeNull();
    expect(googleClientId('not-a-client')).toBeNull();
    expect(googleClientId('123.apps.googleusercontent.com')).toBeNull();
  });

  it('reverses an iOS client id into the URL scheme Google returns to', () => {
    expect(iosGoogleUrlScheme(IOS)).toBe('com.googleusercontent.apps.100000000000-iosclienttest');
    expect(iosGoogleUrlScheme('')).toBeNull();
    expect(iosGoogleUrlScheme('com.googleusercontent.apps.already')).toBeNull();
  });

  it('sends an ID-token request back to that scheme on iOS, and to the package on Android', () => {
    const ids = { ios: IOS, android: ANDROID };
    expect(googleIdTokenRedirect('ios', ids, 'net.brokersconnect.app')).toBe(
      'com.googleusercontent.apps.100000000000-iosclienttest:/oauthredirect',
    );
    expect(googleIdTokenRedirect('android', ids, 'net.brokersconnect.app')).toBe('net.brokersconnect.app:/oauthredirect');
    expect(googleIdTokenRedirect('ios', { ios: '', android: ANDROID }, 'net.brokersconnect.app')).toBeNull();
    expect(googleIdTokenRedirect('android', { ios: IOS, android: '' }, 'net.brokersconnect.app')).toBeNull();
  });
});
