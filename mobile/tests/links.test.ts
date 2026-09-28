import { inOwnTab, webPathToAppPath } from '~/lib/links';

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
  it.each([
    ['/jobs', '/(jobs)/jobs'],
    ['/jobs?track=primary', '/(jobs)/jobs?track=primary'],
    ['/jobs/sales-a1b2', '/(jobs)/jobs/sales-a1b2'],
    ['/companies', '/(companies)/companies'],
    ['/companies/nile', '/(companies)/companies/nile'],
    ['/', '/'],
    ['/notifications', '/notifications'],
    ['/jobsearch', '/jobsearch'],
    ['/auth/confirm?type=signup', '/auth/confirm?type=signup'],
  ])('%s → %s', (input, expected) => {
    expect(inOwnTab(input)).toBe(expected);
  });
});
