import { useId, useState } from 'react';

/**
 * Charts are hand-drawn SVG rather than a charting library. Two reasons: the
 * shapes here are simple, and a library would add hundreds of kilobytes to a
 * bundle whose whole appeal is fitting the Cloudflare free tier.
 *
 * All are single-series, so no legend is needed — the title names the measure —
 * and every bar carries a direct value label, which also discharges the
 * data-viz relief rule for lower-contrast series colors.
 */

export interface BarDatum {
  label: string;
  value: number;
  /** The taxonomy value behind the bar, when the chart is filterable. */
  key?: string;
  /** True when this value is already in the filter. */
  active?: boolean;
}

export function BarChart({
  data, title, note, emptyMessage = 'No data for these filters.', onSelect,
}: {
  data: BarDatum[];
  title: string;
  note?: string;
  emptyMessage?: string;
  /**
   * Called with the taxonomy value when a bar is clicked. Supplying it turns
   * every row into a button: the chart says where the activity is, and the
   * obvious next question is "show me those", which previously meant reading a
   * label off the chart and finding it again in a dropdown.
   */
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <figure className="card" style={{ margin: 0 }}>
      <figcaption>
        <h2>{title}</h2>
        {note && <p className="subtle">{note}</p>}
      </figcaption>

      {data.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>{emptyMessage}</p>
      ) : (
        <div role="img" aria-label={`${title}. ${data.map((d) => `${d.label}: ${d.value}`).join('. ')}`}>
          {data.map((d) => {
            const clickable = Boolean(onSelect && d.key);
            // The grid lives in CSS rather than here so the phone breakpoint
            // can narrow the label column; an inline style would outrank it.
            //
            // A button when it filters and a plain div when it does not: a
            // control that looks identical whether or not it does anything is
            // worse than no control, and a real <button> answers the keyboard
            // without any of this having to think about it.
            const Row = (clickable ? 'button' : 'div') as 'button' | 'div';
            return (
            <Row
              key={d.key ?? d.label}
              type={clickable ? 'button' : undefined}
              className={['bar-row', clickable ? 'bar-row-action' : '',
                          d.active ? 'is-on' : ''].filter(Boolean).join(' ')}

              aria-pressed={clickable ? Boolean(d.active) : undefined}
              title={clickable
                ? (d.active ? `Remove the ${d.label} filter` : `Show only ${d.label}`)
                : d.label}
              onClick={clickable ? () => onSelect!(d.key!) : undefined}
            >
              {/* Wraps rather than truncates. "P29 – Regulatory compliance &
                  change" is longer than any fixed column that also leaves room
                  for a bar, and an ellipsis in this chart hides exactly the
                  part that distinguishes one process from its neighbour. */}
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {d.label}
              </span>

              <span style={{ display: 'block', height: 12, position: 'relative' }}>
                <span
                  style={{
                    display: 'block',
                    width: `${Math.max((d.value / max) * 100, d.value > 0 ? 1.5 : 0)}%`,
                    height: '100%',
                    background: 'var(--series-1)',
                    // Rounded data-end only; the baseline end stays square.
                    borderRadius: '0 4px 4px 0',
                  }}
                />
              </span>

              <span
                className="num"
                style={{
                  fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-secondary)',
                }}
              >
                {d.value}
              </span>
            </Row>
            );
          })}
        </div>
      )}
    </figure>
  );
}

export interface TrendPoint {
  day: string;
  n: number;
}

export type TrendBucket = 'day' | 'week' | 'month';

/**
 * Insert the buckets the query returned nothing for, as zeroes.
 *
 * GROUP BY only emits buckets that have rows, so a quiet fortnight arrives as
 * two adjacent points and the line is drawn straight between them — which reads
 * as steady coverage across exactly the period that had none. Harmless on
 * months, badly misleading on days, which is the view that exists to show the
 * delta.
 *
 * Bounded: a malformed label must not spin here, and nobody can read a chart of
 * ten thousand points anyway.
 */
const MAX_POINTS = 1500;

export function fillGaps(data: TrendPoint[], bucket: TrendBucket): TrendPoint[] {
  if (data.length < 2) return data;

  const step = (label: string): string => {
    if (bucket === 'month') {
      const [y, m] = label.split('-').map(Number);
      if (!y || !m) return label;
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    const at = new Date(`${label}T00:00:00Z`);
    if (Number.isNaN(at.getTime())) return label;
    at.setUTCDate(at.getUTCDate() + (bucket === 'week' ? 7 : 1));
    // Months returned above; day and week are both plain dates here.
    return at.toISOString().slice(0, 10);
  };

  const seen = new Map(data.map((d) => [d.day, d.n]));
  const out: TrendPoint[] = [];
  const last = data[data.length - 1]!.day;

  let cursor = data[0]!.day;
  while (out.length < MAX_POINTS) {
    out.push({ day: cursor, n: seen.get(cursor) ?? 0 });
    if (cursor === last) return out;
    const next = step(cursor);
    if (next === cursor) break;          // unparseable label: stop rather than spin
    cursor = next;
  }
  return data;                            // gave up: show the real points, not a guess
}

const BUCKETS: { key: TrendBucket; label: string }[] = [
  { key: 'day', label: 'Days' },
  { key: 'week', label: 'Weeks' },
  { key: 'month', label: 'Months' },
];

/** Article volume over time, with a crosshair and tooltip on hover. */
export function TrendChart({ data, title, note, bucket, onBucket }: {
  data: TrendPoint[];
  title: string;
  note?: string;
  bucket?: TrendBucket;
  onBucket?: (b: TrendBucket) => void;
}) {
  const gradientId = useId();

  const [hover, setHover] = useState<number | null>(null);

  const buckets = onBucket && bucket ? (
    <div className="viewswitch" style={{ margin: 0 }} role="group" aria-label="Time bucket">
      {BUCKETS.map((b) => (
        <button
          key={b.key}
          type="button"
          className={`btn-quiet${bucket === b.key ? ' is-on' : ''}`}
          aria-pressed={bucket === b.key}
          onClick={() => onBucket(b.key)}
        >
          {b.label}
        </button>
      ))}
    </div>
  ) : null;

  // Placed below every hook on purpose. An early return above useState
  // changes how many hooks run between renders, which React rejects with
  // error #310 and takes the whole page down with it.
  //
  // One point is not a trend. Drawing it fills the whole plot with a flat slab
  // that reads as "constant across the period" when it means "we only have one
  // period" — say which, rather than draw something misleading.
  if (data.length < 2) {
    return (
      <section className="card">
        <div className="chart-head">
          <h3 style={{ margin: '0 0 4px' }}>{title}</h3>
          {buckets}
        </div>
        {note && <p className="subtle" style={{ marginTop: 0 }}>{note}</p>}
        <p className="subtle" style={{ padding: '24px 0', margin: 0 }}>
          {data.length === 0
            ? 'No coverage in this period.'
            : `Only one period has coverage so far (${data[0]!.day}, `
              + `${data[0]!.n} article${data[0]!.n === 1 ? '' : 's'}). `
              + 'A trend needs history — run the backfill to load previous years.'}
        </p>
      </section>
    );
  }

  // A wide viewBox: the SVG scales to its container's width, so the aspect
  // ratio here decides the rendered height. 5:1 keeps a long time series
  // readable without the card becoming a tower.
  const width = 1000;
  const height = 190;
  const pad = { top: 14, right: 14, bottom: 28, left: 38 };

  if (data.length === 0) {
    return (
      <figure className="card" style={{ margin: 0 }}>
        <figcaption><h2>{title}</h2>{note && <p className="subtle">{note}</p>}</figcaption>
        <p className="muted" style={{ fontSize: 13 }}>No data for these filters.</p>
      </figure>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.n));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const x = (i: number) =>
    pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.n).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(data.length - 1).toFixed(1)} ${pad.top + innerH} `
             + `L ${x(0).toFixed(1)} ${pad.top + innerH} Z`;

  const ticks = [0, Math.round(max / 2), max];
  const active = hover !== null ? data[hover] : null;

  return (
    <figure className="card" style={{ margin: 0 }}>
      <figcaption>
        <div className="chart-head">
          <h2>{title}</h2>
          {buckets}
        </div>
        {note && <p className="subtle">{note}</p>}
      </figcaption>

      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          // Width-driven with an auto height: a fixed pixel height letterboxes
          // the viewBox inside a wide container and wastes the plot area.
          style={{ width: '100%', height: 'auto', display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${title}. ${data.map((d) => `${d.day}: ${d.n}`).join('. ')}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * width;
            const ratio = (px - pad.left) / innerW;
            const idx = Math.round(ratio * (data.length - 1));
            setHover(Math.max(0, Math.min(data.length - 1, idx)));
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)}
                stroke="var(--border)" strokeWidth="1"
              />
              <text
                x={pad.left - 6} y={y(t) + 4} textAnchor="end"
                fontSize="10" fill="var(--text-muted)"
              >
                {t}
              </text>
            </g>
          ))}

          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line} fill="none" stroke="var(--series-1)" strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round"
          />

          {active && hover !== null && (
            <g>
              <line
                x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH}
                stroke="var(--border-strong)" strokeWidth="1"
              />
              {/* A surface-colored ring keeps the marker legible over the line. */}
              <circle
                cx={x(hover)} cy={y(active.n)} r="5"
                fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth="2"
              />
            </g>
          )}

          <text x={pad.left} y={height - 8} fontSize="10" fill="var(--text-muted)">
            {data[0]!.day}
          </text>
          {data.length > 1 && (
            <text
              x={width - pad.right} y={height - 8} textAnchor="end"
              fontSize="10" fill="var(--text-muted)"
            >
              {data[data.length - 1]!.day}
            </text>
          )}
        </svg>

        {active && (
          <div
            style={{
              position: 'absolute', top: 0, right: 0,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '4px 8px',
              fontSize: 12, pointerEvents: 'none',
            }}
          >
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{active.n}</strong>
            <span className="muted"> on {active.day}</span>
          </div>
        )}
      </div>
    </figure>
  );
}

export function StatTile({ label, value, note }: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}
