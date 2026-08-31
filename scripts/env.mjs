import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal .env.local reader, so the scripts pick up the same values the app
 * does without pulling in dotenv. Real environment variables win.
 */
export function loadEnv() {
  const file = join(ROOT, '.env.local');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const at = trimmed.indexOf('=');
    if (at === -1) continue;

    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function require_(name, hint) {
  const value = process.env[name];
  if (!value || value.startsWith('placeholder') || value === 'PASTE-HERE') {
    console.error(`Missing ${name}${hint ? `\n  ${hint}` : ''}`);
    process.exit(1);
  }
  return value;
}

export { ROOT };
