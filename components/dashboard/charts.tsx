'use client';

import { useId, useMemo, useState } from 'react';
import { cn, formatNumber, formatPercent } from '@/lib/ui';

/**
 * Inline SVG charts.
 *
 * Hand-built rather than pulled from a charting library, for three reasons:
 * the shapes needed here are simple, the bundle stays small, and every mark
 * detail (cap radius, segment gap, label policy) can follow the design system
 * exactly instead of fighting a library's defaults.
 *
 * Shared rules, applied by every chart below:
 *  - 2px stroke on lines, 4px rounded data-ends on bars, >=8px hit targets.
 *  - A 2px surface-coloured gap between adjacent fills, so touching segments
 *    read as separate marks.
 *  - Grid and axes are recessive; the data carries the contrast.
 *  - Labels wear text tokens, never the series colour.
 *  - Every chart has a hover layer and an accessible table fallback.
 */

const SURFACE = '#171923';

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  sparkline,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'accent';
  sparkline?: number[];
}) {
  const valueTone = {
    neutral: 'text-ink',
    good: 'text-status-good',
    warning: 'text-status-warning',
    critical: 'text-status-critical',
    accent: 'text-accent',
  }[tone];

  return (
    <div className="panel flex flex-col justify-between gap-3 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <div className="flex items-end justify-between gap-3">
        <p className={cn('text-2xl font-semibold tabular-nums tracking-tight', valueTone)}>
          {value}
        </p>
        {sparkline && sparkline.length > 1 ? <Sparkline values={sparkline} /> : null}
      </div>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const width = 72;
  const height = 24;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => `${index * step},${height - (value / max) * (height - 3) - 1.5}`)
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#00a3c3"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Line chart (single series, time)
// ---------------------------------------------------------------------------

export interface TimePoint {
  date: string;
  questions: number;
  averageConfidence: number;
}

export function ActivityChart({ points }: { points: TimePoint[] }) {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const width = 720;
  const height = 200;
  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const max = Math.max(...points.map((p) => p.questions), 4);
  const step = points.length > 1 ? plotW / (points.length - 1) : plotW;

  const x = (index: number) => pad.left + index * step;
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.questions)}`).join(' ');
  const areaPath = `${path} L${x(points.length - 1)},${pad.top + plotH} L${x(0)},${pad.top + plotH} Z`;

  const ticks = [0, Math.round(max / 2), max];
  const active = hover !== null ? points[hover] : null;

  if (points.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-ink-muted">No activity recorded yet.</p>
    );
  }

  return (
    <figure className="m-0 min-w-0">
      <div className="relative min-w-0 overflow-x-auto px-2 pb-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[200px] w-full min-w-[520px]"
          role="img"
          aria-labelledby={titleId}
          onMouseLeave={() => setHover(null)}
        >
          <title id={titleId}>
            Questions asked per day over the last {points.length} days. Peak {max} questions.
          </title>

          <g className="chart-grid">
            {ticks.map((tick) => (
              <line key={tick} x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            ))}
          </g>
          {ticks.map((tick) => (
            <text
              key={tick}
              className="chart-axis-label"
              x={pad.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
            >
              {tick}
            </text>
          ))}

          <defs>
            <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00a3c3" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#00a3c3" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#activity-fill)" />
          <path
            d={path}
            fill="none"
            stroke="#00a3c3"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Crosshair on hover. */}
          {active ? (
            <line
              x1={x(hover as number)}
              x2={x(hover as number)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="#333a4d"
              strokeWidth={1}
            />
          ) : null}

          {points.map((point, index) => (
            <g key={point.date}>
              {hover === index ? (
                <circle
                  cx={x(index)}
                  cy={y(point.questions)}
                  r={4.5}
                  fill="#00a3c3"
                  stroke={SURFACE}
                  strokeWidth={2}
                />
              ) : null}
              {/* Hit target is far wider than the mark. */}
              <rect
                x={x(index) - step / 2}
                y={pad.top}
                width={Math.max(step, 10)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
              />
            </g>
          ))}

          {points.map((point, index) =>
            index % Math.ceil(points.length / 6) === 0 ? (
              <text
                key={`label-${point.date}`}
                className="chart-axis-label"
                x={x(index)}
                y={height - 8}
                textAnchor="middle"
              >
                {point.date.slice(5)}
              </text>
            ) : null,
          )}
        </svg>

        {active ? (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-edge-strong bg-canvas-overlay px-3 py-2 text-xs shadow-lift"
            style={{ left: `min(calc(100% - 190px), ${(x(hover as number) / width) * 100}%)` }}
          >
            <p className="font-medium text-ink">{active.date}</p>
            <p className="mt-1 text-ink-muted">
              {formatNumber(active.questions)} question{active.questions === 1 ? '' : 's'}
            </p>
            <p className="text-ink-muted">
              Mean confidence{' '}
              {active.questions > 0 ? formatPercent(active.averageConfidence) : 'n/a'}
            </p>
          </div>
        ) : null}
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>Daily question volume</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Questions</th>
              <th scope="col">Average confidence</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <th scope="row">{point.date}</th>
                <td>{point.questions}</td>
                <td>{formatPercent(point.averageConfidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar chart (magnitude, single series)
// ---------------------------------------------------------------------------

export function BarList({
  items,
  valueLabel,
  emptyMessage = 'No data yet.',
}: {
  items: { label: string; value: number; secondary?: string }[];
  valueLabel: string;
  emptyMessage?: string;
}) {
  const max = useMemo(() => Math.max(...items.map((item) => item.value), 1), [items]);

  if (items.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-ink-muted">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-2.5 px-5 py-4">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-ink" title={item.label}>
              {item.label}
            </span>
            {/* Direct label: values live in text tokens, never the mark colour. */}
            <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink-muted">
              {formatNumber(item.value)}
              {item.secondary ? (
                <span className="ml-2 text-ink-faint">{item.secondary}</span>
              ) : null}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-canvas-sunken"
            role="img"
            aria-label={`${item.label}: ${item.value} ${valueLabel}`}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Segmented bar (composition, status-coloured)
// ---------------------------------------------------------------------------

export interface Segment {
  label: string;
  value: number;
  tone: 'good' | 'warning' | 'critical' | 'neutral' | 'accent';
}

const SEGMENT_FILL: Record<Segment['tone'], string> = {
  good: '#4fa866',
  warning: '#bd871c',
  critical: '#cd5f5f',
  neutral: '#7d879f',
  accent: '#00a3c3',
};

/**
 * Composition bar. Segments carry a status colour but always ship with a text
 * label and a count in the legend, so the colour is reinforcement rather than
 * the sole carrier of meaning.
 */
export function SegmentedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (total === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-ink-muted">No answers recorded yet.</p>
    );
  }

  return (
    <div className="px-5 py-4">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-canvas-sunken">
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <div
              key={segment.label}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${(segment.value / total) * 100}%`,
                backgroundColor: SEGMENT_FILL[segment.tone],
              }}
              title={`${segment.label}: ${segment.value}`}
            />
          ))}
      </div>

      <ul className="mt-4 space-y-2">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: SEGMENT_FILL[segment.tone] }}
              />
              <span className="truncate text-ink-muted">{segment.label}</span>
            </span>
            <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink">
              {formatNumber(segment.value)}
              <span className="ml-2 text-ink-faint">{formatPercent(segment.value / total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confidence meter
// ---------------------------------------------------------------------------

export function ConfidenceMeter({
  value,
  threshold,
  compact,
}: {
  value: number;
  threshold?: number;
  compact?: boolean;
}) {
  const percent = Math.round(value * 100);
  const tone =
    threshold === undefined
      ? 'accent'
      : value >= threshold
        ? 'good'
        : value >= threshold * 0.75
          ? 'warning'
          : 'critical';
  const fill = { accent: '#00a3c3', good: '#4fa866', warning: '#bd871c', critical: '#cd5f5f' }[
    tone
  ];

  return (
    <div className={cn('flex items-center gap-2', compact ? 'w-28' : 'w-full max-w-xs')}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas-sunken"
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Retrieval confidence"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${percent}%`, backgroundColor: fill }}
        />
      </div>
      <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-muted">{percent}%</span>
    </div>
  );
}
