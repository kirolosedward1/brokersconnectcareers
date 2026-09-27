#!/usr/bin/env node
/**
 * Applies docs/security/vercel-firewall.json to the Vercel project.
 *
 *   VERCEL_TOKEN=… VERCEL_TEAM_ID=team_… VERCEL_PROJECT_ID=prj_… node scripts/vercel-firewall.mjs --dry-run
 *   VERCEL_TOKEN=… VERCEL_TEAM_ID=team_… VERCEL_PROJECT_ID=prj_… node scripts/vercel-firewall.mjs
 *
 * Reads the active configuration first and prints what would change, so the
 * dashboard's own edits are not silently overwritten. The Firewall API is
 * documented at https://vercel.com/docs/rest-api/reference/endpoints/security.
 * Managed rulesets (CRS) and Bot Protection are plan features; the CRS block
 * is sent, and anything the plan does not support is reported back by the API.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const desired = JSON.parse(readFileSync(join(ROOT, 'docs/security/vercel-firewall.json'), 'utf8'));
delete desired.$comment;

const token = process.env.VERCEL_TOKEN;
const teamId = process.env.VERCEL_TEAM_ID;
const projectId = process.env.VERCEL_PROJECT_ID;
const dryRun = process.argv.includes('--dry-run');

if (!token || !projectId) {
  console.error('Set VERCEL_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for a team project).');
  process.exit(1);
}

const base = 'https://api.vercel.com';
const query = new URLSearchParams({ projectId, ...(teamId ? { teamId } : {}) });
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const current = await fetch(`${base}/v1/security/firewall/config/active?${query}`, { headers });
if (!current.ok) {
  console.error(`could not read the active configuration: ${current.status} ${await current.text()}`);
  process.exit(1);
}
const active = await current.json();

const names = (rules) => new Set((rules ?? []).map((rule) => rule.name));
const have = names(active.rules);
const want = names(desired.rules);
console.log('rules to add:   ', [...want].filter((n) => !have.has(n)).join(', ') || 'none');
console.log('rules to keep:  ', [...want].filter((n) => have.has(n)).join(', ') || 'none');
console.log('rules to remove:', [...have].filter((n) => !want.has(n)).join(', ') || 'none');

if (dryRun) {
  console.log('\n--dry-run: nothing applied.');
  process.exit(0);
}

const response = await fetch(`${base}/v1/security/firewall/config?${query}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(desired),
});
const body = await response.text();
if (!response.ok) {
  console.error(`apply failed: ${response.status} ${body}`);
  process.exit(1);
}
console.log('\napplied. Check Project → Firewall → Overview for matches over the next week.');
