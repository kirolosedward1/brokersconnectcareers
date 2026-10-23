import type { Actor } from '@/lib/permissions';
import { withoutLeakedParams } from '~/lib/leaked-params';
import { webEntryHref } from '~/lib/web-entry-path';

const signedOut: Actor = null;
const employer: Actor = {
  userId: '22222222-2222-4222-8222-222222222222',
  profile: { role: 'employer', approval_status: 'approved' },
  company: { id: '33333333-3333-4333-8333-333333333333', verification_status: 'verified' },
};
const admin: Actor = {
  userId: '77777777-7777-4777-8777-777777777777',
  profile: { role: 'admin', approval_status: 'approved' },
  company: null,
};

describe('a pasted web address', () => {
  it('opens a listing in the tab that owns it', () => {
    expect(webEntryHref('/jobs/sales-a1b2', '', signedOut)).toBe('/(jobs)/jobs/sales-a1b2');
    expect(webEntryHref('/jobs/sales-a1b2', '', employer)).toBe('/(home)/jobs/sales-a1b2');
    expect(webEntryHref('/jobs/sales-a1b2', '', admin)).toBe('/(admin)/jobs/sales-a1b2');
  });

  it('leaves an address that already names its screen', () => {
    expect(webEntryHref('/(jobs)/jobs/sales-a1b2', '', signedOut)).toBeNull();
    expect(webEntryHref('/', '', signedOut)).toBeNull();
  });
});

describe('a deep link copied onto the screen under it', () => {
  it('drops the slug from the anchor and keeps it on the listing', () => {
    const state = {
      routes: [
        {
          name: '(tabs)',
          params: { slug: 'sales-a1b2' },
          state: {
            routes: [
              {
                name: '(jobs)',
                params: { slug: 'sales-a1b2' },
                state: {
                  index: 1,
                  routes: [
                    { name: 'jobs/index', params: { slug: 'sales-a1b2', track: 'primary' } },
                    { name: 'jobs/[slug]', params: { slug: 'sales-a1b2' } },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const next = withoutLeakedParams(state);
    expect(next.routes[0].params).toBeUndefined();
    const jobs = next.routes[0].state?.routes[0].state?.routes;
    expect(jobs?.[0].params).toEqual({ track: 'primary' });
    expect(jobs?.[1].params).toEqual({ slug: 'sales-a1b2' });
  });
});
