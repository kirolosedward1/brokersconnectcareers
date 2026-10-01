/**
 * Controlled abuse, one attack at a time, each asserting that the defence
 * engaged. STAGING ONLY — see load/README.md.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, guard, signIn } from './lib.js';

export const options = {
  scenarios: {
    scrape_directory: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '30s', preAllocatedVUs: 30, exec: 'scrapeDirectory' },
    harvest_contacts: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'harvestContacts', startTime: '35s' },
    spam_applications: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'spamApplications', startTime: '40s' },
    stuff_credentials: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'stuffCredentials', startTime: '45s' },
  },
  thresholds: { checks: ['rate>0.95'] },
};

export function setup() {
  guard();
  return {};
}

/** (1) Paging the directory fast, anonymously. */
export function scrapeDirectory() {
  const res = http.get(`${BASE}/agents?page=${1 + Math.floor(Math.random() * 5)}`, { tags: { name: 'scrape' } });
  check(res, {
    'edge throttles or the page carries no contact': (r) =>
      r.status === 429 || r.status === 403 || (r.status === 200 && !/\+20\d{9,10}/.test(r.body) && !/wa\.me/.test(r.body)),
  });
}

/** (2) Opening every consultant's number from one employer account. */
export function harvestContacts() {
  const session = signIn('employer1@demo.test', __ENV.DEMO_PASSWORD);
  if (!session) return;
  const url = __ENV.SUPABASE_URL;
  const key = __ENV.SUPABASE_ANON_KEY;
  const headers = { apikey: key, authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };

  // Directly against PostgREST, which is what a script would do.
  const list = http.post(`${url}/rest/v1/rpc/search_agents`, JSON.stringify({ p_limit: 60 }), { headers, tags: { name: 'rpc:search' } });
  check(list, { 'directory rpc answers a signed-in employer': (r) => r.status === 200 });
  const handles = (list.json() || []).map((row) => row.slug);

  let limited = false;
  for (const handle of handles.slice(0, 45)) {
    const res = http.post(`${url}/rest/v1/rpc/reveal_agent_contact`, JSON.stringify({ p_handle: handle }), { headers, tags: { name: 'rpc:reveal' } });
    const row = (res.json() || [])[0];
    if (row && row.status === 'rate_limited') {
      limited = true;
      break;
    }
  }
  check(null, { 'reveals are refused past the hourly allowance': () => limited });
}

/** (3) Applying to everything in a loop. */
export function spamApplications() {
  const session = signIn('candidate1@demo.test', __ENV.DEMO_PASSWORD);
  if (!session) return;
  const url = __ENV.SUPABASE_URL;
  const key = __ENV.SUPABASE_ANON_KEY;
  const headers = { apikey: key, authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json', prefer: 'return=minimal' };

  const jobs = http.get(`${url}/rest/v1/jobs?select=id&status=eq.active&limit=40`, { headers, tags: { name: 'rest:jobs' } }).json() || [];
  let limited = false;
  for (const job of jobs) {
    const res = http.post(`${url}/rest/v1/applications`, JSON.stringify({ job_id: job.id, candidate_id: session.user.id }), { headers, tags: { name: 'rest:apply' } });
    if (res.status >= 400 && /application_rate_limit/.test(res.body)) {
      limited = true;
      break;
    }
  }
  check(null, { 'applications are refused past eight in ten minutes': () => limited });
}

/** (4) Twenty wrong passwords against one address. */
export function stuffCredentials() {
  const url = __ENV.SUPABASE_URL;
  const key = __ENV.SUPABASE_ANON_KEY;
  let refused = false;
  for (let i = 0; i < 20; i += 1) {
    const res = http.post(`${url}/auth/v1/token?grant_type=password`, JSON.stringify({ email: 'candidate1@demo.test', password: `wrong-${i}` }), {
      headers: { apikey: key, 'content-type': 'application/json' },
      tags: { name: 'auth:stuff' },
    });
    if (res.status === 429 || /captcha/i.test(res.body)) {
      refused = true;
      break;
    }
    sleep(0.2);
  }
  check(null, { 'the auth server refuses a run of failures (rate limit or captcha)': () => refused });
}
