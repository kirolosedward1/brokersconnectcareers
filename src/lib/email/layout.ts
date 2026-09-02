import 'server-only';
import { dirOf } from '@/i18n/routing';

/**
 * The one email shell.
 *
 * Email HTML is not web HTML. There is no external stylesheet, no CSS custom
 * properties, no grid, and Outlook still renders through Word. So: tables,
 * inline styles, hex colours written out longhand, and a single column at
 * 600px — the width every client has agreed on for twenty years.
 *
 * RTL is set on the html element and again on every block, because several
 * clients strip the outer attributes and keep the inner ones.
 */

const BRAND = '#3b32de';
const INK = '#111827';
const SOFT = '#6b7280';
const LINE = '#e5e7eb';
const CANVAS = '#f4f5fa';

export type Button = { label: string; href: string };

export function renderEmail({
  locale,
  siteName,
  preheader,
  heading,
  paragraphs,
  button,
  facts,
  footerNote,
  unsubscribe,
}: {
  locale: string;
  siteName: string;
  /** The grey line clients show next to the subject. Worth writing properly. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  button?: Button;
  /** Label/value rows — the job, the company, the new status. */
  facts?: [string, string][];
  footerNote: string;
  unsubscribe?: { label: string; href: string };
}): string {
  const dir = dirOf(locale);
  const align = dir === 'rtl' ? 'right' : 'left';

  const factRows = (facts ?? [])
    .map(
      ([label, value]) => `
        <tr>
          <td align="${align}" style="padding:6px 0;font-size:13px;color:${SOFT};white-space:nowrap;">${escape(label)}</td>
          <td align="${align}" style="padding:6px 0 6px 16px;font-size:14px;color:${INK};font-weight:600;">${escape(value)}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${escape(locale)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="${dir}"
             style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;">

        <tr>
          <td dir="${dir}" align="${align}" style="padding:20px 28px;border-bottom:1px solid ${LINE};font-size:16px;font-weight:700;color:${BRAND};">
            ${escape(siteName)}
          </td>
        </tr>

        <tr>
          <td dir="${dir}" align="${align}" style="padding:28px 28px 8px;">
            <h1 style="margin:0;font-size:20px;line-height:1.45;color:${INK};font-weight:700;">${escape(heading)}</h1>
          </td>
        </tr>

        ${paragraphs
          .map(
            (p) => `
        <tr>
          <td dir="${dir}" align="${align}" style="padding:8px 28px;font-size:15px;line-height:1.75;color:${SOFT};">
            ${escape(p)}
          </td>
        </tr>`,
          )
          .join('')}

        ${
          factRows
            ? `
        <tr>
          <td dir="${dir}" align="${align}" style="padding:16px 28px 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="${dir}"
                   style="width:100%;background:${CANVAS};border-radius:10px;padding:12px 16px;">
              ${factRows}
            </table>
          </td>
        </tr>`
            : ''
        }

        ${
          button
            ? `
        <tr>
          <td dir="${dir}" align="${align}" style="padding:22px 28px 8px;">
            <a href="${escape(button.href)}"
               style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 26px;border-radius:9px;">
              ${escape(button.label)}
            </a>
          </td>
        </tr>`
            : ''
        }

        <tr>
          <td dir="${dir}" align="${align}" style="padding:24px 28px 26px;border-top:1px solid ${LINE};margin-top:16px;font-size:12px;line-height:1.7;color:${SOFT};">
            ${escape(footerNote)}
            ${
              unsubscribe
                ? `<br><a href="${escape(unsubscribe.href)}" style="color:${SOFT};text-decoration:underline;">${escape(unsubscribe.label)}</a>`
                : ''
            }
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * Plain-text alternative.
 *
 * Not optional: a message with no text part scores worse with spam filters,
 * and a meaningful share of this market reads mail in clients that prefer it.
 */
export function renderText({
  heading,
  paragraphs,
  button,
  facts,
  footerNote,
  unsubscribe,
}: {
  heading: string;
  paragraphs: string[];
  button?: Button;
  facts?: [string, string][];
  footerNote: string;
  unsubscribe?: { label: string; href: string };
}): string {
  const parts = [heading, '', ...paragraphs];

  if (facts?.length) {
    parts.push('');
    for (const [label, value] of facts) parts.push(`${label}: ${value}`);
  }
  if (button) parts.push('', `${button.label}: ${button.href}`);

  parts.push('', '—', footerNote);
  if (unsubscribe) parts.push(`${unsubscribe.label}: ${unsubscribe.href}`);

  return parts.join('\n');
}

/** Values interpolated here are names and job titles people typed. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
