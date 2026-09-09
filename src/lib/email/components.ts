/**
 * The email design system.
 *
 * Email HTML is not web HTML. There is no external stylesheet, no custom
 * properties, no grid, no flex, and Outlook still renders through Word. So:
 * tables, inline styles, hex written longhand, and a single 600px column — the
 * width every client has agreed on for twenty years.
 *
 * Templates do not write HTML. They choose blocks and hand over strings; this
 * file is the only place a tag is typed, which is also the only way to be sure
 * every interpolated job title and candidate name is escaped. A template that
 * could write its own markup is a template that can forget.
 *
 * RTL is set on <html> and again on every block, because several clients strip
 * the outer attributes and keep the inner ones. Arabic is the default here in
 * the same way it is the default everywhere else on this platform.
 *
 * This file imports nothing, deliberately. Direction arrives as an argument
 * rather than being looked up, and the escaping lives here rather than in a
 * module of its own — a renderer that reaches for the application's routing or
 * environment can only run inside the application, and this one has to be
 * loadable by the test suite and by the script that generates the Supabase
 * Auth templates. That is what lets those templates share this design instead
 * of being a second one that drifts.
 */

/** Every value interpolated into a template is a name, a title or a note. */
export function escape(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A URL that is safe to put in href.
 *
 * Templates build their links from the configured base URL, so this is a
 * backstop rather than the main defence — but `javascript:` in an href is one
 * missed validation away whenever a link can carry a user-supplied path, and
 * the cost of checking is a comparison. Anything that is not plainly http,
 * https or mailto becomes `#`.
 */
export function safeHref(value: string): string {
  const trimmed = String(value).trim();
  return /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed) ? escape(trimmed) : '#';
}

const BRAND = '#3b32de';
const INK = '#111827';
const SOFT = '#6b7280';
const FAINT = '#9ca3af';
const LINE = '#e5e7eb';
const CANVAS = '#f4f5fa';
const PANEL = '#f8f9fc';
const WHITE = '#ffffff';

const TONE = {
  neutral: { bg: '#eef0f6', fg: '#374151' },
  info: { bg: '#e8e9fb', fg: '#3730a3' },
  positive: { bg: '#e7f6ee', fg: '#15803d' },
  caution: { bg: '#fef3e2', fg: '#92400e' },
  closed: { bg: '#fdeaea', fg: '#b91c1c' },
} as const;

export type Tone = keyof typeof TONE;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,'Helvetica Neue',sans-serif";

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type Button = { label: string; href: string };

export type Block =
  /** A paragraph. */
  | { kind: 'text'; value: string }
  /** InfoCard: label/value rows on a tinted panel — the job, the company, the date. */
  | { kind: 'facts'; rows: [string, string][] }
  /** JobCard: one role, as it appears on the board. */
  | {
      kind: 'job';
      title: string;
      company: string;
      /** Location, employment type, salary, commission — whatever is public. */
      meta?: string[];
      href?: string;
    }
  /** CompanyCard: who is hiring, with their logo if they have one. */
  | { kind: 'company'; name: string; logoUrl?: string | null; meta?: string[]; href?: string }
  /** StatusBadge, optionally showing what it moved from. */
  | { kind: 'status'; label: string; tone: Tone; from?: string }
  /** SecurityNotice: the "if this wasn't you" panel. */
  | { kind: 'security'; value: string }
  | { kind: 'divider' }
  | { kind: 'button'; label: string; href: string; variant?: 'primary' | 'secondary' }
  /** HelpSection: where to go when the email did not answer it. */
  | { kind: 'help'; value: string; link?: Button };

function pad(dir: string, align: string, padding: string, inner: string) {
  return `<tr><td dir="${dir}" align="${align}" style="padding:${padding};">${inner}</td></tr>`;
}

function renderBlock(block: Block, dir: string, align: string): string {
  switch (block.kind) {
    case 'text':
      return pad(
        dir,
        align,
        '8px 28px',
        `<p style="margin:0;font-size:15px;line-height:1.8;color:${SOFT};">${escape(block.value)}</p>`,
      );

    case 'facts': {
      const rows = block.rows
        .map(
          ([label, value]) => `
            <tr>
              <td align="${align}" style="padding:7px 0;font-size:13px;color:${SOFT};white-space:nowrap;font-family:${FONT};">${escape(label)}</td>
              <td align="${align}" style="padding:7px 0;font-size:14px;color:${INK};font-weight:600;font-family:${FONT};">${escape(value)}</td>
            </tr>`,
        )
        .join('');
      return pad(
        dir,
        align,
        '14px 28px 6px',
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}"
                style="background:${PANEL};border:1px solid ${LINE};border-radius:10px;">
           <tr><td style="padding:8px 16px;">
             <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}">${rows}</table>
           </td></tr>
         </table>`,
      );
    }

    case 'job': {
      const meta = (block.meta ?? []).filter(Boolean);
      const title = block.href
        ? `<a href="${safeHref(block.href)}" style="color:${INK};text-decoration:none;">${escape(block.title)}</a>`
        : escape(block.title);
      return pad(
        dir,
        align,
        '10px 28px',
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}"
                style="background:${WHITE};border:1px solid ${LINE};border-radius:10px;">
           <tr><td dir="${dir}" align="${align}" style="padding:14px 16px;font-family:${FONT};">
             <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.5;">${title}</div>
             <div style="font-size:13px;color:${SOFT};padding-top:3px;">${escape(block.company)}</div>
             ${
               meta.length
                 ? `<div style="font-size:12px;color:${FAINT};padding-top:6px;line-height:1.7;">${meta
                     .map(escape)
                     .join(' &nbsp;·&nbsp; ')}</div>`
                 : ''
             }
           </td></tr>
         </table>`,
      );
    }

    case 'company': {
      const meta = (block.meta ?? []).filter(Boolean);
      const name = block.href
        ? `<a href="${safeHref(block.href)}" style="color:${INK};text-decoration:none;">${escape(block.name)}</a>`
        : escape(block.name);
      // The logo is one cell of a two-cell row rather than a float: floats are
      // not reliable in Outlook, and a table cell is.
      const logo = block.logoUrl
        ? `<td width="52" style="padding:0 0 0 12px;" dir="${dir}">
             <img src="${safeHref(block.logoUrl)}" width="40" height="40" alt=""
                  style="display:block;width:40px;height:40px;border-radius:8px;border:1px solid ${LINE};object-fit:cover;">
           </td>`
        : '';
      const cells =
        dir === 'rtl'
          ? `${logo}<td dir="${dir}" align="${align}">`
          : `${logo.replace('padding:0 0 0 12px', 'padding:0 12px 0 0')}<td dir="${dir}" align="${align}">`;
      return pad(
        dir,
        align,
        '10px 28px',
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}"
                style="background:${WHITE};border:1px solid ${LINE};border-radius:10px;">
           <tr><td style="padding:14px 16px;font-family:${FONT};">
             <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" dir="${dir}"><tr>
               ${cells}
                 <div style="font-size:15px;font-weight:700;color:${INK};">${name}</div>
                 ${
                   meta.length
                     ? `<div style="font-size:12px;color:${FAINT};padding-top:4px;">${meta
                         .map(escape)
                         .join(' &nbsp;·&nbsp; ')}</div>`
                     : ''
                 }
               </td>
             </tr></table>
           </td></tr>
         </table>`,
      );
    }

    case 'status': {
      const tone = TONE[block.tone];
      const badge = `<span style="display:inline-block;background:${tone.bg};color:${tone.fg};font-size:13px;font-weight:700;padding:6px 14px;border-radius:999px;font-family:${FONT};">${escape(block.label)}</span>`;
      const before = block.from
        ? `<span style="font-size:13px;color:${FAINT};text-decoration:line-through;font-family:${FONT};">${escape(block.from)}</span>
           <span style="font-size:13px;color:${FAINT};padding:0 8px;">${dir === 'rtl' ? '←' : '→'}</span>`
        : '';
      return pad(dir, align, '14px 28px 6px', `${before}${badge}`);
    }

    case 'security':
      return pad(
        dir,
        align,
        '14px 28px 6px',
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}"
                style="background:${TONE.caution.bg};border-radius:10px;">
           <tr><td dir="${dir}" align="${align}" style="padding:14px 16px;font-size:13px;line-height:1.8;color:${TONE.caution.fg};font-family:${FONT};">
             ${escape(block.value)}
           </td></tr>
         </table>`,
      );

    case 'divider':
      return pad(dir, align, '18px 28px', `<div style="height:1px;background:${LINE};line-height:1px;">&nbsp;</div>`);

    case 'button': {
      const secondary = block.variant === 'secondary';
      const bg = secondary ? WHITE : BRAND;
      const fg = secondary ? BRAND : WHITE;
      const border = secondary ? `border:1px solid ${BRAND};` : 'border:0;';
      const href = safeHref(block.href);
      // Outlook renders through Word and drops border-radius and padding on an
      // anchor, so it gets a VML rectangle instead. Every other client ignores
      // the conditional comment and takes the anchor.
      return pad(
        dir,
        align,
        '20px 28px 8px',
        `<!--[if mso]>
           <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                        href="${href}" style="height:44px;v-text-anchor:middle;width:240px;" arcsize="20%"
                        ${secondary ? `strokecolor="${BRAND}"` : 'stroke="f"'} fillcolor="${bg}">
             <w:anchorlock/>
             <center style="color:${fg};font-family:${FONT};font-size:15px;font-weight:600;">${escape(block.label)}</center>
           </v:roundrect>
         <![endif]-->
         <!--[if !mso]><!-- -->
         <a href="${href}"
            style="display:inline-block;background:${bg};color:${fg};${border}text-decoration:none;font-family:${FONT};font-size:15px;font-weight:600;padding:13px 28px;border-radius:9px;">
           ${escape(block.label)}
         </a>
         <!--<![endif]-->`,
      );
    }

    case 'help': {
      const link = block.link
        ? ` <a href="${safeHref(block.link.href)}" style="color:${BRAND};text-decoration:underline;">${escape(block.link.label)}</a>`
        : '';
      return pad(
        dir,
        align,
        '16px 28px 4px',
        `<p style="margin:0;font-size:13px;line-height:1.8;color:${FAINT};">${escape(block.value)}${link}</p>`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

export type EmailFooter = {
  /** "This is an automated message." */
  automated: string;
  /** Why they are receiving it. */
  reason: string;
  legal: { label: string; href: string }[];
  /** Optional mail only. Transactional carries none, deliberately. */
  unsubscribe?: { label: string; href: string };
};

export function renderEmail({
  locale,
  dir,
  siteName,
  logoUrl,
  preheader,
  heading,
  blocks,
  footer,
}: {
  locale: string;
  dir: 'rtl' | 'ltr';
  siteName: string;
  /** Absolute — an email has no origin to resolve a relative path against. */
  logoUrl?: string;
  /** The grey line clients show next to the subject. Worth writing properly. */
  preheader: string;
  heading: string;
  blocks: Block[];
  footer: EmailFooter;
}): string {
  const align = dir === 'rtl' ? 'right' : 'left';

  const legal = footer.legal
    .map(
      (item) =>
        `<a href="${safeHref(item.href)}" style="color:${FAINT};text-decoration:underline;">${escape(item.label)}</a>`,
    )
    .join(` <span style="color:${LINE};">|</span> `);

  const mark = logoUrl
    ? `<img src="${safeHref(logoUrl)}" width="168" height="25" alt="${escape(siteName)}"
            style="display:block;width:168px;height:25px;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-size:17px;font-weight:700;color:${BRAND};">${escape(siteName)}</span>`;

  return `<!doctype html>
<html lang="${escape(locale)}" dir="${dir}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(heading)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  /* One media query, for the one thing that actually needs it: a 600px table
     on a 360px phone. Everything else is inline. */
  @media only screen and (max-width:620px) {
    .shell { width:100% !important; }
    .gutter { padding-left:18px !important; padding-right:18px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escape(preheader)}</div>
<!-- Stops Gmail pulling the next line of markup into the preview. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="${dir}" class="shell"
             style="width:100%;max-width:600px;background:${WHITE};border:1px solid ${LINE};border-radius:14px;overflow:hidden;font-family:${FONT};">

        <tr>
          <td dir="${dir}" align="${align}" class="gutter" style="padding:22px 28px;border-bottom:1px solid ${LINE};">
            ${mark}
          </td>
        </tr>

        <tr>
          <td dir="${dir}" align="${align}" class="gutter" style="padding:28px 28px 6px;">
            <h1 style="margin:0;font-size:21px;line-height:1.45;color:${INK};font-weight:700;">${escape(heading)}</h1>
          </td>
        </tr>

        ${blocks.map((block) => renderBlock(block, dir, align)).join('')}

        <tr>
          <td dir="${dir}" align="${align}" class="gutter" style="padding:24px 28px 26px;border-top:1px solid ${LINE};font-size:12px;line-height:1.9;color:${FAINT};">
            <div style="font-weight:600;color:${SOFT};">${escape(siteName)}</div>
            <div>${escape(footer.reason)}</div>
            <div>${escape(footer.automated)}</div>
            ${legal ? `<div style="padding-top:6px;">${legal}</div>` : ''}
            ${
              footer.unsubscribe
                ? `<div style="padding-top:6px;"><a href="${safeHref(footer.unsubscribe.href)}" style="color:${FAINT};text-decoration:underline;">${escape(footer.unsubscribe.label)}</a></div>`
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
 * The plain-text alternative.
 *
 * Not optional. A message with no text part scores worse with every spam
 * filter, and a meaningful share of this market reads mail in clients that
 * prefer it. Built from the same blocks, so the two can never drift.
 */
export function renderText({
  heading,
  blocks,
  footer,
  siteName,
}: {
  heading: string;
  blocks: Block[];
  footer: EmailFooter;
  siteName: string;
}): string {
  const lines: string[] = [heading, ''];

  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        lines.push(block.value, '');
        break;
      case 'facts':
        for (const [label, value] of block.rows) lines.push(`${label}: ${value}`);
        lines.push('');
        break;
      case 'job':
        lines.push(
          `${block.title} — ${block.company}`,
          ...(block.meta?.length ? [block.meta.join(' · ')] : []),
          ...(block.href ? [block.href] : []),
          '',
        );
        break;
      case 'company':
        lines.push(block.name, ...(block.meta?.length ? [block.meta.join(' · ')] : []), '');
        break;
      case 'status':
        lines.push(block.from ? `${block.from} -> ${block.label}` : block.label, '');
        break;
      case 'security':
        lines.push(block.value, '');
        break;
      case 'divider':
        lines.push('—', '');
        break;
      case 'button':
        lines.push(`${block.label}: ${block.href}`, '');
        break;
      case 'help':
        lines.push(block.link ? `${block.value} ${block.link.href}` : block.value, '');
        break;
    }
  }

  lines.push('—', siteName, footer.reason, footer.automated);
  for (const item of footer.legal) lines.push(`${item.label}: ${item.href}`);
  if (footer.unsubscribe) {
    lines.push(`${footer.unsubscribe.label}: ${footer.unsubscribe.href}`);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
