/** A marketing campaign lands: the board and one listing, all at once. */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, guard, page } from './lib.js';

export const options = {
  scenarios: {
    campaign: {
      executor: 'ramping-vus',
      startVUs: 20,
      stages: [
        { duration: '30s', target: 600 },
        { duration: '2m', target: 600 },
        { duration: '30s', target: 20 },
      ],
    },
    health: {
      executor: 'constant-vus',
      vus: 1,
      duration: '3m',
      exec: 'health',
    },
  },
  thresholds: {
    'http_req_duration{scenario:campaign}': ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
    'checks{scenario:health}': ['rate>0.99'],
  },
};

export function setup() {
  guard();
  const html = page('/jobs').body;
  const slug = html.match(/href="\/jobs\/([a-z0-9-]+)"/)?.[1];
  return { slug };
}

export default function ({ slug }) {
  page('/jobs', 'board');
  if (slug) page(`/jobs/${slug}`, 'job');
  sleep(0.5 + Math.random());
}

export function health() {
  const res = http.get(`${BASE}/api/health`, { tags: { name: 'health' } });
  check(res, { 'health stays up': (r) => r.status === 200 && r.json('database') === true });
  sleep(5);
}
