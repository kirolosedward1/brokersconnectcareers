'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { cn, formatDayMonth, formatNumber } from '@/lib/utils';

export type ActivityDay = {
  d: string;
  signups: number;
  published: number;
  applications: number;
};

type SeriesKey = 'applications' | 'published' | 'signups';
type Range = 7 | 30 | 90;

const SERIES: { key: SeriesKey; tone: string }[] = [
  { key: 'applications', tone: 'var(--primary)' },
  { key: 'published', tone: 'var(--success)' },
  { key: 'signups', tone: 'var(--warning)' },
];

const RANGES: Range[] = [7, 30, 90];

/**
 * Platform activity, as a chart an admin can read with a finger.
 *
 * Time runs left to right — oldest on the left — the same judgement the
 * static chart makes. The chrome around it follows the page: the value axis
 * is the first flex child, so in Arabic it sits on the right, and the dates
 * are Arabic month names with Western digits.
 *
 * A day opens the list that series counts. On a phone the first tap shows the
 * day; the links inside the tooltip, or a second tap, open it.
 */
export function ActivityChart({
  days,
  locale,
  title,
  hint,
  empty,
  labels,
}: {
  days: ActivityDay[];
  locale: string;
  title: string;
  hint?: string;
  empty: string;
  labels: {
    applications: string;
    published: string;
    signups: string;
    ranges: Record<Range, string>;
    rangeLabel: string;
    versus: string;
  };
}) {
  const router = useRouter();
  const plotId = useId();
  const plot = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<Range>(30);
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const pointer = useRef<string>('mouse');

  const { shown, previous } = sliceWindow(days, range);
  const visible = SERIES.filter((series) => !hidden.has(series.key));
  const peak = Math.max(0, ...visible.flatMap((series) => shown.map((day) => day[series.key])));
  const max = niceCeiling(peak);
  const count = shown.length;

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!plot.current?.closest('figure')?.contains(event.target as Node)) setActive(null);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  const step = count > 1 ? 100 / (count - 1) : 100;
  const x = (index: number) => (count > 1 ? index * step : 50);
  const y = (value: number) => 100 - (value / max) * 100;
  const n = (value: number) => formatNumber(value, locale);
  const axis = (iso: string) => formatDayMonth(iso, locale);
  const ticks = tickIndexes(count);

  function hrefFor(key: SeriesKey, day: string) {
    if (key === 'applications') return `/admin/applications?day=${day}`;
    if (key === 'published') return `/admin/jobs?status=all&published=${day}`;
    return `/admin/users?joined=${day}`;
  }

  function preferred(index: number) {
    const series = SERIES.find((item) => !hidden.has(item.key));
    if (!series || !shown[index]) return null;
    return hrefFor(series.key, shown[index].d);
  }

  function indexAt(event: { clientX: number }) {
    const box = plot.current?.getBoundingClientRect();
    if (!box || count === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    return count <= 1 ? 0 : Math.round(ratio * (count - 1));
  }

  function openDay(index: number) {
    const href = preferred(index);
    if (href) router.push(href);
  }

  const labelOf = (key: SeriesKey) => labels[key];

  return (
    <figure className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <style>{`
        .activity-line { stroke-dasharray: 1; stroke-dashoffset: 0; }
        @media (prefers-reduced-motion: no-preference) {
          .activity-line { animation: activity-draw 800ms ease-out both; }
        }
        @keyframes activity-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
      `}</style>
      <figcaption className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
        </div>
        <div role="radiogroup" aria-label={labels.rangeLabel} className="flex rounded-lg border border-border p-0.5">
          {RANGES.map((value) => {
            const on = value === range;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                className={cn(
                  'min-h-11 rounded-md px-3 text-sm',
                  on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                )}
                onClick={() => {
                  setRange(value);
                  setActive(null);
                }}
              >
                {labels.ranges[value]}
              </button>
            );
          })}
        </div>
      </figcaption>

      <ul className="mt-4 flex flex-wrap gap-2">
        {SERIES.map((series) => {
          const on = !hidden.has(series.key);
          const total = shown.reduce((sum, day) => sum + day[series.key], 0);
          const before = previous ? previous.reduce((sum, day) => sum + day[series.key], 0) : null;
          const delta = before == null ? null : total - before;
          return (
            <li key={series.key}>
              <button
                type="button"
                aria-pressed={on}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm',
                  on ? 'bg-card' : 'bg-muted/40 text-muted-foreground',
                )}
                onClick={() => {
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(series.key)) next.delete(series.key);
                    else next.add(series.key);
                    return next;
                  });
                  setActive(null);
                }}
              >
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: series.tone, opacity: on ? 1 : 0.35 }} />
                <span>{labelOf(series.key)}</span>
                <span className="numeral font-semibold">{n(total)}</span>
                {delta != null ? (
                  <span className="numeral text-xs text-muted-foreground" title={labels.versus}>
                    {signed(delta, locale)}
                    <span className="sr-only"> {labels.versus}</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {peak === 0 || count === 0 ? (
        <p className="grid h-40 place-items-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-5">
          <div className="flex gap-2">
            <div className="relative w-8 shrink-0 text-xs text-muted-foreground">
              {[max, max / 2, 0].map((value, index) => (
                <span key={value} className="numeral absolute end-0 -translate-y-1/2" style={{ top: `${index * 50}%` }}>
                  {n(value)}
                </span>
              ))}
            </div>

            <div
              ref={plot}
              dir="ltr"
              className="relative h-40 flex-1 touch-pan-y sm:h-48"
              onPointerMove={(event) => {
                if (event.pointerType === 'touch') return;
                pointer.current = event.pointerType;
                setActive(indexAt(event));
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'touch') return;
                setActive(null);
              }}
              onPointerDown={(event) => {
                pointer.current = event.pointerType;
                if (event.pointerType !== 'touch') return;
                const index = indexAt(event);
                if (active === index) openDay(index);
                else setActive(index);
              }}
              onClick={(event) => {
                if (pointer.current === 'touch') return;
                openDay(indexAt(event));
              }}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
                {[0, 50, 100].map((at) => (
                  <line key={at} x1={0} x2={100} y1={at} y2={at} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                {active != null ? (
                  <line
                    x1={x(active)}
                    x2={x(active)}
                    y1={0}
                    y2={100}
                    stroke="var(--muted-foreground)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="3 3"
                  />
                ) : null}
                {visible.map((series) => {
                  const points = shown.map((day, index) => ({ x: x(index), y: y(day[series.key]) }));
                  return (
                    <path
                      key={`${series.key}-${range}`}
                      className="activity-line"
                      d={smoothPath(points)}
                      fill="none"
                      stroke={series.tone}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pathLength={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>

              {active != null
                ? visible.map((series) => (
                    <span
                      key={series.key}
                      aria-hidden
                      className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                      style={{
                        left: `${x(active)}%`,
                        top: `${y(shown[active]?.[series.key] ?? 0)}%`,
                        background: series.tone,
                      }}
                    />
                  ))
                : null}

              {active != null && shown[active] ? (
                <div
                  role="dialog"
                  aria-label={axis(shown[active].d)}
                  className="pointer-events-auto absolute z-10 w-max max-w-[16rem] -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-md"
                  style={{
                    left: `${Math.min(88, Math.max(12, x(active)))}%`,
                    bottom: 'calc(100% - 8px)',
                  }}
                  dir={locale === 'ar' ? 'rtl' : 'ltr'}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <p className="font-medium">{axis(shown[active].d)}</p>
                  <ul className="mt-1 space-y-0.5">
                    {visible.map((series) => (
                      <li key={series.key}>
                        <a
                          href={hrefFor(series.key, shown[active].d)}
                          className="flex items-center justify-between gap-4 rounded hover:underline"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            router.push(hrefFor(series.key, shown[active].d));
                          }}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden className="size-2 rounded-full" style={{ background: series.tone }} />
                            {labelOf(series.key)}
                          </span>
                          <span className="numeral font-semibold">{n(shown[active][series.key])}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <div className="w-8 shrink-0" />
            <div dir="ltr" className="numeral flex flex-1 justify-between text-xs text-muted-foreground">
              {ticks.map((index) => (
                <span key={index}>{shown[index] ? axis(shown[index].d) : ''}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="sr-only">
        <table>
          <caption>
            {title} — {labels.ranges[range]}
          </caption>
          <thead>
            <tr>
              <th scope="col">{labels.rangeLabel}</th>
              {visible.map((series) => (
                <th key={series.key} scope="col">
                  {labelOf(series.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((day) => (
              <tr key={day.d}>
                <th scope="row">{axis(day.d)}</th>
                {visible.map((series) => (
                  <td key={series.key}>{n(day[series.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span id={plotId} className="sr-only">
        {labels.versus}
      </span>
    </figure>
  );
}

function sliceWindow(days: ActivityDay[], range: number) {
  const end = days.length;
  const start = Math.max(0, end - range);
  const shown = days.slice(start);
  const prevStart = start - shown.length;
  const previous = prevStart >= 0 ? days.slice(prevStart, start) : null;
  return { shown, previous: previous && previous.length === shown.length ? previous : null };
}

function niceCeiling(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 4, 5, 6, 8]) {
    const candidate = step * power;
    if (candidate >= value) return candidate;
  }
  return 10 * power;
}

function tickIndexes(count: number): number[] {
  if (count <= 1) return [0];
  const mid = Math.floor((count - 1) / 2);
  const indexes = count > 40 ? [0, Math.floor((count - 1) / 3), mid, Math.floor(((count - 1) * 2) / 3), count - 1] : [0, mid, count - 1];
  return [...new Set(indexes)];
}

function signed(value: number, locale: string): string {
  const abs = formatNumber(Math.abs(value), locale);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

/** Catmull-Rom through the points, as one cubic path. Y stays inside the plot. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
