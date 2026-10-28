/**
 * Public Google OAuth client ids, and the addresses made from them.
 *
 * JavaScript because Expo loads app.config as JS and does not compile the
 * modules it imports. The sign-in code uses the same functions, so the scheme
 * a build registers and the scheme a sign-in returns to cannot drift apart.
 */

const SUFFIX = '.apps.googleusercontent.com';
const CLIENT_ID = /^[0-9]+-[0-9A-Za-z_-]+\.apps\.googleusercontent\.com$/;

/** A public client id, or null when the value is missing or not one. */
function googleClientId(value) {
  return typeof value === 'string' && CLIENT_ID.test(value) ? value : null;
}

/**
 * The iOS URL scheme Google's iOS client returns to: the client id reversed
 * (`123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`).
 * Null until a real iOS client id is configured, so a build is not given a
 * scheme that is not Google's.
 */
function iosGoogleUrlScheme(value) {
  const id = googleClientId(value);
  if (!id) return null;
  return `com.googleusercontent.apps.${id.slice(0, -SUFFIX.length)}`;
}

/**
 * Where an ID-token request in the browser should return.
 *
 * On iOS that is Google's own reversed client scheme: an iOS client accepts
 * it without a separate redirect list. On Android it is this app's package,
 * the custom scheme an Android client accepts. Null when that platform's
 * client id is not configured.
 */
function googleIdTokenRedirect(platform, ids, androidPackage) {
  if (platform === 'ios') {
    const scheme = iosGoogleUrlScheme(ids.ios);
    return scheme ? `${scheme}:/oauthredirect` : null;
  }
  if (platform === 'android' && googleClientId(ids.android) && androidPackage) {
    return `${androidPackage}:/oauthredirect`;
  }
  return null;
}

exports.googleClientId = googleClientId;
exports.iosGoogleUrlScheme = iosGoogleUrlScheme;
exports.googleIdTokenRedirect = googleIdTokenRedirect;
