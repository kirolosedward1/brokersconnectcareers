import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  PREVIEW_CASES,
  PREVIEW_TEMPLATES,
  renderPreview,
  type PreviewCase,
} from '@/lib/email/preview';

export const dynamic = 'force-dynamic';

/**
 * Look at every email without sending one.
 *
 * The safety property is structural rather than procedural: this route imports
 * the preview module, which imports the renderers and the copy and nothing
 * else. There is no transport in the import graph, so no argument, typo or
 * query parameter can turn a preview into an outbound message.
 *
 * Open in development, admin-only in production. Not disabled in production,
 * because "what does the rejection email actually say" is a question that gets
 * asked while looking at a real complaint, and the answer should not require a
 * local checkout.
 *
 *   /api/email/preview                     — the index, every template
 *   /api/email/preview?template=job_expired&locale=ar&case=long
 *   /api/email/preview?template=job_expired&format=text
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !(await isAdmin())) {
    return new NextResponse('Not found', { status: 404 });
  }

  const params = request.nextUrl.searchParams;
  const template = params.get('template');
  const locale = params.get('locale') === 'en' ? 'en' : 'ar';
  const variant = (PREVIEW_CASES as string[]).includes(params.get('case') ?? '')
    ? (params.get('case') as PreviewCase)
    : 'default';

  if (!template) return html(index());

  const envelope = renderPreview(template, locale, variant);
  if (!envelope) return new NextResponse('Unknown template', { status: 404 });

  if (params.get('format') === 'text') {
    return new NextResponse(`Subject: ${envelope.subject}\n\n${envelope.text}`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return html(envelope.html);
}

async function isAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    // Allowed to fail quietly, and deliberately fails closed: this is the
    // gate on a route that renders every template in the product. Unknown is
    // treated as "not an admin", which is the answer that costs nothing.
    const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    return data?.role === 'admin';
  } catch {
    return false;
  }
}

function html(body: string) {
  return new NextResponse(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Nothing here is worth caching, and a cached preview of a template
      // somebody just edited is actively misleading.
      'cache-control': 'no-store',
    },
  });
}

/**
 * The index: every template, both languages, all three content cases, at both
 * the widths that matter — 600px desktop and 375px phone, side by side, so a
 * layout that only breaks on a narrow screen breaks in front of you.
 */
function index(): string {
  const rows = PREVIEW_TEMPLATES.map((template) => {
    const links = (['ar', 'en'] as const)
      .flatMap((locale) =>
        PREVIEW_CASES.map((variant) => {
          const query = `template=${template}&locale=${locale}&case=${variant}`;
          return `<a href="?${query}">${locale}/${variant}</a>
                  <a href="?${query}&format=text" class="txt">txt</a>`;
        }),
      )
      .join('');

    return `<tr>
      <th>${template}</th>
      <td class="links">${links}</td>
      <td class="frames">
        <iframe src="?template=${template}&locale=ar&case=default" width="600" height="620" title="${template} desktop"></iframe>
        <iframe src="?template=${template}&locale=ar&case=long" width="375" height="620" title="${template} mobile"></iframe>
      </td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Email previews</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { color: #6b7280; margin: 0 0 24px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; vertical-align: top; padding: 16px 12px 16px 0; white-space: nowrap; font-family: ui-monospace, monospace; }
  td { vertical-align: top; padding: 16px 0; border-top: 1px solid #e5e7eb; }
  th { border-top: 1px solid #e5e7eb; }
  .links a { display: inline-block; margin: 0 6px 6px 0; padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 6px; text-decoration: none; color: #3b32de; font-size: 12px; }
  .links a.txt { color: #6b7280; }
  .frames { width: 100%; }
  iframe { border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; vertical-align: top; margin-inline-end: 12px; }
</style></head>
<body>
<h1>Email previews</h1>
<p class="lede">
  Every template this platform sends. Left frame is 600px desktop in Arabic; right is 375px
  with the long-content fixture, which is where layouts break. Nothing on this page can send.
</p>
<table>${rows}</table>
</body></html>`;
}
