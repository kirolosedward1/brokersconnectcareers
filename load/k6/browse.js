/**
 * Realistic public traffic for ~10k monthly active users at peak.
 *
 * Weights approximate the analytics of a job board: most sessions are the
 * board and a job page; a minority read companies, the directory and the
 * blog; a few land on sign-in.
 */
import { sleep } from 'k6';
import { guard, page } from './lib.js';

export const options = {
  scenarios: {
    readers: {
      executor: 'ramping-vus',
      startVUs: 20,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '5m', target: 400 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.005'],
  },
};

const TRACKS = ['primary', 'resale', 'rental', 'commercial'];
const QUERIES = ['مبيعات', 'استشاري', 'تسويق', 'مدير'];

export function setup() {
  guard();
  // A handful of real slugs from the board, so job pages hit real rows.
  const html = page('/jobs').body;
  const slugs = [...new Set([...html.matchAll(/href="\/jobs\/([a-z0-9-]+)"/g)].map((m) => m[1]))]
    .filter((s) => !/^apply$/.test(s))
    .slice(0, 20);
  return { slugs };
}

export default function ({ slugs }) {
  const roll = Math.random();
  if (roll < 0.15) page('/', 'home');
  else if (roll < 0.45) {
    const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    page(Math.random() < 0.3 ? `/jobs?q=${encodeURIComponent(QUERIES[Math.floor(Math.random() * QUERIES.length)])}` : `/jobs?track=${track}`, 'board');
  } else if (roll < 0.75 && slugs.length) {
    page(`/jobs/${slugs[Math.floor(Math.random() * slugs.length)]}`, 'job');
  } else if (roll < 0.85) page('/companies', 'companies');
  else if (roll < 0.93) page(`/agents?page=${1 + Math.floor(Math.random() * 3)}`, 'directory');
  else if (roll < 0.97) page('/blog', 'blog');
  else page('/sign-in', 'sign-in');
  sleep(1 + Math.random() * 3);
}
