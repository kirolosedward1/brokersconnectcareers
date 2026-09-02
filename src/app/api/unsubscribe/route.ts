import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Turning notifications off, from an email client.
 *
 * POST only, deliberately. Mail clients and corporate scanners prefetch links
 * in messages; an unsubscribe that happened on GET would fire for people who
 * never clicked it, and they would find out by noticing the emails stopped.
 *
 * Two callers arrive here:
 *
 *   - Gmail and Outlook's own unsubscribe control, which posts
 *     `List-Unsubscribe=One-Click` per RFC 8058 and wants a bare 200.
 *   - The confirmation page, whose form post wants a redirect back to a page
 *     that says it worked.
 *
 * The token is the credential — there is no session in an inbox. It grants
 * exactly one power: setting one flag to false.
 */

const KINDS = ['notify_applications', 'notify_status', 'notify_digest'] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string | null): value is Kind {
  return value !== null && (KINDS as readonly string[]).includes(value);
}

/**
 * Written out per branch rather than as a computed key. A dynamic key widens
 * to `{ [x: string]: boolean }`, which the generated row types reject — and
 * spelling the three out means an update can only ever touch a column that
 * appears literally in this file.
 */
function patchFor(kind: Kind) {
  switch (kind) {
    case 'notify_applications':
      return { notify_applications: false };
    case 'notify_status':
      return { notify_status: false };
    case 'notify_digest':
      return { notify_digest: false };
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);

  let body: URLSearchParams;
  try {
    body = new URLSearchParams(await request.text());
  } catch {
    body = new URLSearchParams();
  }

  const token = url.searchParams.get('token') ?? body.get('token');
  const kindParam = url.searchParams.get('kind') ?? body.get('kind');
  const oneClick = body.get('List-Unsubscribe') === 'One-Click';

  // A malformed link is not worth a distinct error: it cannot be acted on
  // either way, and saying which half was wrong only helps someone guessing.
  if (!token || !isKind(kindParam)) {
    return oneClick
      ? new NextResponse(null, { status: 400 })
      : NextResponse.redirect(`${env.siteUrl}/unsubscribe?state=invalid`, 303);
  }

  let ok = false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .update(patchFor(kindParam))
      .eq('unsubscribe_token', token)
      .select('id');

    ok = !error && (data?.length ?? 0) > 0;
  } catch (error) {
    // Unconfigured service role, or an unreachable database. Nothing here is
    // worth a 500 to a mail client that will simply retry.
    console.warn(
      '[unsubscribe] could not apply:',
      error instanceof Error ? error.message : error,
    );
  }

  if (oneClick) {
    // One-click clients show their own confirmation; the status is the answer.
    return new NextResponse(null, { status: ok ? 200 : 502 });
  }

  return NextResponse.redirect(
    `${env.siteUrl}/unsubscribe?state=${ok ? 'done' : 'failed'}`,
    303,
  );
}

/**
 * A GET here means something prefetched the link, or someone pasted it into a
 * browser. Neither should unsubscribe anybody — send them to the page that
 * asks first.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  return NextResponse.redirect(`${env.siteUrl}/unsubscribe${query ? `?${query}` : ''}`, 303);
}
