/**
 * The file Android reads to decide whether links to www.brokersconnect.net
 * open the app without asking (App Links), and whether the app may offer
 * passwords saved for the website — Android's side of
 * src/lib/apple/app-site-association.ts.
 *
 * Android checks one thing: that the site names the app's package and the
 * fingerprint of the certificate it is signed with. Which paths open the app
 * is said in the app itself (mobile/app.config.ts, android.intentFilters).
 *
 * Pure. Served by src/app/.well-known/assetlinks.json/route.ts.
 */

export const ANDROID_PACKAGE = 'net.brokersconnect.app';

/** A SHA-256 certificate fingerprint as Android writes it: 32 bytes in hex, colon-separated. */
const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/**
 * The well-formed fingerprints in a comma-separated setting, upper-cased —
 * the release key's, and the upload key's or a development build's beside it.
 */
export function parseFingerprints(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((fingerprint) => fingerprint.trim().toUpperCase())
    .filter((fingerprint) => FINGERPRINT.test(fingerprint));
}

export function assetLinks(fingerprints: string[]) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
