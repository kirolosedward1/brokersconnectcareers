import { getTranslations } from 'next-intl/server';
import { Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localeHref, type Locale } from '@/i18n/routing';
import { Pagination } from '@/components/pagination';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import type { AdminAuditRow, ModerationNoteRow } from '@/lib/supabase/database.types';

/**
 * The console's furniture.
 *
 * An operations tool, so density and legibility over decoration: ruled rows,
 * small type for facts, colour only for state. Server components throughout —
 * the only JavaScript on a console page is the levers themselves.
 */

export function PageHeader({
  title,
  lede,
  actions,
  back,
}: {
  title: string;
  lede?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-1 inline-flex min-h-8 items-center text-xs text-muted-foreground hover:text-foreground hover:underline">
            ← {back.label}
          </Link>
        ) : null}
        <h1 className="text-xl font-bold leading-tight break-words">{title}</h1>
        {lede ? <p className="mt-0.5 text-sm text-muted-foreground">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Filters as links. A row that scrolls sideways on a phone rather than
 * wrapping into four lines of chips above the thing they filter.
 */
export function FilterTabs({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; href: string; active: boolean; count?: number }[];
}) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 border-b border-border sm:w-auto sm:flex-wrap">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm whitespace-nowrap transition-colors',
                item.active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
              {item.count ? (
                <span className="numeral rounded bg-muted px-1.5 text-xs text-muted-foreground">{item.count}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A plain GET form: works before hydration and without JavaScript, and the
 * result is a URL. The other filters ride along as hidden fields so searching
 * does not silently drop them.
 */
export function SearchForm({
  locale,
  path,
  q,
  keep = {},
  placeholder,
  label,
}: {
  locale: Locale;
  path: string;
  q?: string;
  keep?: Record<string, string | undefined>;
  placeholder: string;
  label: string;
}) {
  return (
    <form method="get" action={localeHref(locale, path)} role="search" className="flex w-full max-w-xl gap-2">
      {Object.entries(keep).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <label className="relative flex-1">
        <span className="sr-only">{label}</span>
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          maxLength={120}
          className="h-11 w-full rounded-lg border border-input bg-card ps-9 pe-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring"
        />
      </label>
      <button
        type="submit"
        className="h-11 shrink-0 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
      >
        {label}
      </button>
    </form>
  );
}

export type Column<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  className?: string;
  /**
   * How the column survives a phone. `title` leads the card, `meta` joins the
   * small line under it, `hidden` is left out — a desktop table squeezed to
   * 360px is not a phone layout.
   */
  mobile?: 'title' | 'meta' | 'aside' | 'hidden';
};

/**
 * Rows of things, as a table on a desk and as a list of cards on a phone.
 *
 * Each row links to its detail page. On a phone the whole card is the link;
 * on a desk the first column is, so the rest of the row stays selectable for
 * copying an id or a name.
 */
export function AdminTable<Row>({
  rows,
  columns,
  rowKey,
  rowHref,
  empty,
  caption,
}: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string;
  empty: string;
  caption: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }

  const title = columns.filter((c) => c.mobile === 'title');
  const meta = columns.filter((c) => c.mobile === 'meta');
  const aside = columns.filter((c) => c.mobile === 'aside');

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cn('px-3 py-2 text-start font-medium', column.className)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="align-top hover:bg-muted/30">
                {columns.map((column, index) => (
                  <td key={column.key} className={cn('px-3 py-2.5', column.className)}>
                    {index === 0 && rowHref ? (
                      <Link href={rowHref(row)} className="font-medium hover:text-primary hover:underline">
                        {column.cell(row)}
                      </Link>
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const body = (
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium break-words">
                  {title.map((column) => (
                    <div key={column.key}>{column.cell(row)}</div>
                  ))}
                </div>
                {meta.length ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {meta.map((column) => (
                      <span key={column.key}>{column.cell(row)}</span>
                    ))}
                  </div>
                ) : null}
              </div>
              {aside.length ? (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {aside.map((column) => (
                    <div key={column.key}>{column.cell(row)}</div>
                  ))}
                </div>
              ) : null}
            </div>
          );
          return (
            <li key={rowKey(row)}>
              {rowHref ? (
                <Link href={rowHref(row)} className="block active:bg-muted/50">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Pagination plus the honest count underneath it. */
export async function Pager({
  page,
  total,
  size,
  buildHref,
  locale,
}: {
  page: number;
  total: number;
  size: number;
  buildHref: (page: number) => string;
  locale: Locale;
}) {
  const t = await getTranslations('admin');
  const pageCount = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t.rich('showing', {
          from: formatNumber(from, locale),
          to: formatNumber(to, locale),
          total: formatNumber(total, locale),
          v: (chunks) => <span className="numeral">{chunks}</span>,
        })}
      </p>
      <Pagination page={page} pageCount={pageCount} buildHref={buildHref} />
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A figure inside Arabic prose, isolated so it reads left to right. */
export function Num({ value, locale }: { value: number; locale: Locale }) {
  return <span className="numeral">{formatNumber(value, locale)}</span>;
}

/**
 * What happened to this thing, and what the admins wrote about it, in one
 * column, newest first. The two are separate tables with separate rules — the
 * record is written by the levers, a note by a person — but an admin reading
 * a case wants them in the order they happened.
 */
export async function Trail({
  audit,
  notes,
  locale,
}: {
  audit: AdminAuditRow[];
  notes: ModerationNoteRow[];
  locale: Locale;
}) {
  const t = await getTranslations('admin');
  const entries = [
    ...audit.map((row) => ({ kind: 'audit' as const, at: row.created_at, row })),
    ...notes.map((row) => ({ kind: 'note' as const, at: row.created_at, row })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('trailEmpty')}</p>;
  }

  const time = (at: string) =>
    `${formatDate(at, locale)} · ${new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Cairo',
    }).format(new Date(at))}`;

  return (
    <ol className="space-y-3">
      {entries.map((entry) =>
        entry.kind === 'audit' ? (
          <li key={`a${entry.row.id}`} className="border-s-2 border-primary/40 ps-3 text-sm">
            <p>
              <span className="font-medium">{auditLabel(t, entry.row.action)}</span>
              {entry.row.via === 'direct' ? (
                <span className="ms-2 rounded bg-warning-muted px-1.5 text-xs text-warning">{t('viaDirect')}</span>
              ) : null}
            </p>
            {entry.row.reason ? <p className="mt-0.5 text-muted-foreground">«{entry.row.reason}»</p> : null}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {entry.row.actor_name ?? t('unknownActor')} · {time(entry.at)}
            </p>
          </li>
        ) : (
          <li key={`n${entry.row.id}`} className="border-s-2 border-warning/60 ps-3 text-sm">
            <p className="whitespace-pre-line">{entry.row.body}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('noteBy', { name: entry.row.author_name ?? t('unknownActor') })} · {time(entry.at)}
            </p>
          </li>
        ),
      )}
    </ol>
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations<'admin'>>>;

/** The sentence for an audit action, or the action itself for one we have not named. */
export function auditLabel(t: Translator, action: string): string {
  const slug = action.replace('.', '_');
  return t.has(`auditAction.${slug}` as never) ? t(`auditAction.${slug}` as never) : action;
}
