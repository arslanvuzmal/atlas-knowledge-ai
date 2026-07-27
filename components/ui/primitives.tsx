import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';

/**
 * Shared presentational primitives.
 *
 * All of these are server-safe: no state, no effects. Interactivity lives in
 * the dedicated client components so that dashboard pages can remain server
 * components and read from the database directly.
 */

export function Panel({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  // `min-w-0` is essential, not cosmetic. A grid or flex item defaults to
  // `min-width: auto`, meaning it refuses to shrink below its content's
  // intrinsic width. A panel holding a wide chart or table would therefore
  // stretch its column past the viewport and make the whole page scroll
  // sideways, instead of letting the inner overflow-x container do its job.
  return <Tag className={cn('panel min-w-0', className)}>{children}</Tag>;
}

export function PanelHeader({
  title,
  description,
  action,
  id,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-5 py-4">
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {description ? <p className="mt-1 text-xs text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

type Tone = 'neutral' | 'accent' | 'iris' | 'good' | 'warning' | 'critical';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-edge-strong bg-canvas-overlay text-ink-muted',
  accent: 'border-accent/40 bg-accent-wash text-accent-soft',
  iris: 'border-iris/40 bg-iris-wash text-iris-soft',
  good: 'border-status-good/40 bg-status-good/10 text-status-good',
  warning: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
  critical: 'border-status-critical/40 bg-status-critical/10 text-status-critical',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Status indicator. The dot is decorative: the text label carries the meaning,
 * so state is never communicated by colour alone.
 */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  const dot: Record<Tone, string> = {
    neutral: 'bg-status-neutral',
    accent: 'bg-accent',
    iris: 'bg-iris',
    good: 'bg-status-good',
    warning: 'bg-status-warning',
    critical: 'bg-status-critical',
  };
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
      <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', dot[tone])} />
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="max-w-md text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function DataTable({
  headers,
  children,
  caption,
}: {
  headers: (string | { label: string; align?: 'left' | 'right' })[];
  children: ReactNode;
  caption?: string;
}) {
  return (
    // Wide tables scroll inside their own container; the page never scrolls
    // horizontally.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-edge">
            {headers.map((header) => {
              const label = typeof header === 'string' ? header : header.label;
              const align = typeof header === 'string' ? 'left' : (header.align ?? 'left');
              return (
                <th
                  key={label}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint',
                    align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-edge-subtle">{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({
  children,
  align = 'left',
  className,
  mono,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-4 py-3 align-middle text-ink-muted',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'font-mono text-[13px] tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function DefinitionList({ items }: { items: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wider text-ink-faint">{item.term}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InlineNote({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const border: Record<Tone, string> = {
    neutral: 'border-l-edge-strong',
    accent: 'border-l-accent',
    iris: 'border-l-iris',
    good: 'border-l-status-good',
    warning: 'border-l-status-warning',
    critical: 'border-l-status-critical',
  };
  return (
    <div
      className={cn(
        'rounded-r-md border-l-2 bg-canvas-sunken px-4 py-3 text-sm text-ink-muted',
        border[tone],
      )}
    >
      {children}
    </div>
  );
}
