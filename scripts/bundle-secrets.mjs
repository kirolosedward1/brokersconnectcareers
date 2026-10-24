#!/usr/bin/env node
/**
 * Does a client bundle carry a server secret?
 *
 *   node scripts/bundle-secrets.mjs <dir> [<dir> …]
 *
 * Reads every file under each directory — the app's `expo export` output, the
 * website's `.next/static` — and exits 1 naming the file and the kind of
 * secret when one is found. Never prints the value, not even part of it: this
 * runs in public CI logs.
 *
 * What a bundle may hold is the publishable Supabase key and public URLs. What
 * it must never hold is anything that bypasses row-level security or signs on
 * the platform's behalf: a secret or service-role key, a database URL with its
 * password, a private key, a webhook signing secret, a mail API key. Any of
 * those in a bundle is in every visitor's browser and every installed phone.
 *
 * The JWT rule decodes the payload instead of matching text, so a legacy anon
 * key (role "anon") passes and a service-role key (role "service_role") does
 * not, whatever else the token says.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Each rule: a name for the report and a test over the file's text. */
export const RULES = [
  { name: 'Supabase secret key (sb_secret_)', test: (text) => /sb_secret_[A-Za-z0-9_-]{10,}/.test(text) },
  { name: 'service-role JWT', test: (text) => findJwts(text).some((claims) => claims.role === 'service_role') },
  {
    name: 'database URL with a password',
    test: (text) => /postgres(?:ql)?:\/\/[^:\s/'"`]+:[^@\s'"`]{4,}@[A-Za-z0-9.-]+/.test(text),
  },
  { name: 'private key', test: (text) => /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text) },
  { name: 'webhook signing secret (whsec_)', test: (text) => /whsec_[A-Za-z0-9+/=]{20,}/.test(text) },
  { name: 'Resend API key', test: (text) => /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{12,}/.test(text) },
  { name: 'Expo access token', test: (text) => /\bexpo_[A-Za-z0-9_-]{30,}/i.test(text) && /EXPO_(?:ACCESS_)?TOKEN/.test(text) },
];

/** The payloads of every well-formed JWT in the text, decoded; malformed ones are skipped. */
function findJwts(text) {
  const out = [];
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      out.push(JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')));
    } catch {
      // Not a JWT after all.
    }
  }
  return out;
}

/** Every file under dir, recursively. */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** [{ file, rule }] for every rule a file breaks; empty when the bundle is clean. */
export function scan(dirs) {
  const findings = [];
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      // Every file, images and fonts included: binary decoded as latin1 is
      // noise the rules do not match, and a secret in an asset is still one.
      const text = readFileSync(file).toString('latin1');
      for (const rule of RULES) {
        if (rule.test(text)) findings.push({ file: relative(process.cwd(), file), rule: rule.name });
      }
    }
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('usage: node scripts/bundle-secrets.mjs <dir> [<dir> …]');
    process.exit(2);
  }
  const findings = scan(dirs);
  if (findings.length) {
    for (const { file, rule } of findings) console.error(`SECRET IN BUNDLE  ${rule}  ${file}`);
    console.error(`\n${findings.length} finding(s). A client bundle must hold only public values.`);
    process.exit(1);
  }
  console.log(`bundle-secrets: clean (${dirs.join(', ')})`);
}
