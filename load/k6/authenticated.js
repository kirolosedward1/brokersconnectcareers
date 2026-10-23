/**
 * Signed-in work at honest rates. A 429 anywhere in here is a limit set too
 * low, and the run fails on it on purpose.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, guard, page, signIn } from './lib.js';

export const options = {
  scenarios: {
    candidates: { executor: 'constant-vus', vus: 40, duration: '3m', exec: 'candidate' },
    employers: { executor: 'constant-vus', vus: 15, duration: '3m', exec: 'employer' },
    admins: { executor: 'constant-vus', vus: 1, duration: '3m', exec: 'admin' },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    'http_req_failed': ['rate<0.005'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  guard();
  return {};
}

export function candidate() {
  if (!signIn('candidate1@demo.test', __ENV.DEMO_PASSWORD)) return;
  page('/dashboard', 'dashboard');
  page('/jobs', 'board');
  page('/dashboard/applications', 'applications');
  page('/agents', 'directory');
  sleep(2 + Math.random() * 4);
}

export function employer() {
  if (!signIn('employer1@demo.test', __ENV.DEMO_PASSWORD)) return;
  page('/employer', 'employer');
  page('/employer/applicants', 'applicants');
  const list = page('/agents', 'directory').body;
  const handles = [...list.matchAll(/href="\/agents\/([a-z0-9-]+)"/g)].map((m) => m[1]).slice(0, 3);
  for (const handle of handles) {
    const res = http.get(`${BASE}/agents/${handle}`, { tags: { name: 'consultant' } });
    check(res, { 'consultant page 200': (r) => r.status === 200, 'no phone in the html': (r) => !/\+20\d{9,10}/.test(r.body) });
    sleep(3 + Math.random() * 5);
  }
}

export function admin() {
  if (!signIn('admin@demo.test', __ENV.DEMO_PASSWORD)) return;
  // Without a TOTP factor enrolled and ADMIN_MFA_REQUIRED unset on a preview,
  // the console opens; with it required, this lands on the account page,
  // which is also a 200 and also fine to measure.
  page('/admin', 'admin');
  page('/admin/jobs', 'queue');
  page('/admin/security', 'security');
  sleep(10);
}
