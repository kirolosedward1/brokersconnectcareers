import { formatDayMonth, formatNumber } from '@/lib/utils';

/**
 * A thirty-day chart, drawn rather than imported.
 *
 * There is no charting library in this project and this is the reason not to
 * add one: a line, an axis and a fill is a few dozen lines of markup, and the
 * smallest library that draws it ships a client bundle and a render pass for
 * something that never changes after the server sends it. Everything here is
 * server-rendered — no JavaScript reaches the browser.
 *
 * Only the geometry is SVG. Every label is HTML beside it, which is what makes
 * this legible on a phone: an SVG with text inside scales the type down with
 * the plot, and at 375px the axis came out around five pixels tall. Labels
 * outside stay at their real size at any width, and the plot is then free to
 * stretch — hence a 0–100 viewBox, `preserveAspectRatio="none"`, and
 * non-scaling strokes so a stretched line is still two pixels thick.
 *
 * Colour comes from the theme's own tokens, so it follows light and dark
 * without a second palette to keep in sync.
 *
 * The plot runs left to right even in Arabic. That is a judgement call rather
 * than a rule: this codebase already treats numbers as an LTR island — Western
 * numerals inside Arabic prose — and an axis of dates and counts is the same
 * kind of island. Mirroring it would put the newest day on the left, which is
 * not where anyone reaching for a trend line looks. The `dir` also settles
 * which side the value axis sits on.
 */
export type TrendSeries = {
  key: string;
  label: string;
  /** A theme token, not a hex value, so the line themes with everything else. */
  tone: 'primary' | 'success' | 'warning';
  values: number[];
};

const TONE: Record<TrendSeries['tone'], string> = {
  primary: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
};

/**
 * A round number at or above the peak, so the axis labels are readable.
 *
 * Every candidate is even, because the middle gridline is half of it and a
 * chart with 7.5 written up its side is one nobody reads twice.
 */
function niceCeiling(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 4, 5, 6, 8]) {
    const candidate = step * power;
    if (candidate >= value) return candidate;
  }
  return 10 * power;
}

export function TrendChart({
  id,
  title,
  hint,
  days,
  series,
  locale,
  empty,
}: {
  /** Unique on the page: the fill gradients are referenced by id. */
  id: string;
  title: string;
  hint?: string;
  /** ISO dates, one per point, gaps already filled in by the database. */
  days: string[];
  series: TrendSeries[];
  locale: string;
  /** Shown instead of a flat line when the whole window is zero. */
  empty: string;
}) {
  const peak = Math.max(0, ...series.flatMap((s) => s.values));
  const max = niceCeiling(peak);
  const single = series.length === 1;

  const step = days.length > 1 ? 100 / (days.length - 1) : 100;
  const x = (index: number) => (days.length > 1 ? index * step : 50);
  const y = (value: number) => 100 - (value / max) * 100;

  const n = (value: number) => formatNumber(value, locale);
  const axis = (iso: string) => formatDayMonth(iso, locale);

  // First, middle and last. Thirty dates across one axis is a grey smear.
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1];

  return (
    <figure className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
        </div>

        {series.length > 1 ? (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ background: TONE[s.tone] }}
                />
                {s.label}
              </li>
            ))}
          </ul>
        ) : null}
      </figcaption>

      {peak === 0 ? (
        <p className="grid h-40 place-items-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-5" dir="ltr" aria-hidden>
          <div className="flex gap-2">
            {/* The value axis. Positioned against the plot's own height, so the
                labels line up with the gridlines at any size. */}
            <div className="relative w-8 shrink-0 text-xs text-muted-foreground">
              {[max, max / 2, 0].map((value, index) => (
                <span
                  key={value}
                  className="numeral absolute end-0 -translate-y-1/2"
                  style={{ top: `${index * 50}%` }}
                >
                  {n(value)}
                </span>
              ))}
            </div>

            <div className="relative h-40 flex-1 sm:h-48">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 size-full overflow-visible"
                focusable="false"
              >
                <defs>
                  {series.map((s) => (
                    <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={TONE[s.tone]} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={TONE[s.tone]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>

                {[0, 50, 100].map((at) => (
                  <line
                    key={at}
                    x1={0}
                    x2={100}
                    y1={at}
                    y2={at}
                    stroke="var(--border)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {series.map((s) => {
                  const line = s.values.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
                  return (
                    <g key={s.key}>
                      {/* Filled only when it is the one series on the chart.
                          Three translucent fills stacked on one axis read as a
                          colour wash, not as three quantities. */}
                      {single ? (
                        <path
                          d={`${line} L ${x(s.values.length - 1)} 100 L ${x(0)} 100 Z`}
                          fill={`url(#${id}-${s.key})`}
                        />
                      ) : null}
                      <path
                        d={line}
                        fill="none"
                        stroke={TONE[s.tone]}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}

                {/* One hit column per day, carrying a native tooltip for every
                    series at once — a readout without a line of JavaScript. */}
                {days.map((day, index) => (
                  <rect
                    key={day}
                    x={Math.max(0, x(index) - step / 2)}
                    y={0}
                    width={step}
                    height={100}
                    fill="transparent"
                  >
                    <title>
                      {[
                        axis(day),
                        ...series.map((s) => `${s.label}: ${n(s.values[index] ?? 0)}`),
                      ].join('\n')}
                    </title>
                  </rect>
                ))}
              </svg>

              {/* Where each series ends. In HTML rather than SVG so it stays a
                  circle instead of stretching into an ellipse with the plot. */}
              {series.map((s) => (
                <span
                  key={s.key}
                  className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: '100%',
                    top: `${y(s.values.at(-1) ?? 0)}%`,
                    background: TONE[s.tone],
                  }}
                />
              ))}
            </div>
          </div>

          <div className="numeral mt-2 flex justify-between ps-10 text-xs text-muted-foreground">
            {ticks.map((index) => (
              <span key={index}>{axis(days[index])}</span>
            ))}
          </div>
        </div>
      )}

      {/* The chart, as something a screen reader can actually read. */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{axis(days[0])}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day, index) => (
            <tr key={day}>
              <th scope="row">{axis(day)}</th>
              {series.map((s) => (
                <td key={s.key}>{n(s.values[index] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
