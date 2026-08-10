import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';

export function Panel({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
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
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-3">
      <div className="min-w-0">
        <h2 id={id} className="text-xs font-bold uppercase tracking-wider text-ink font-mono">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-edge pb-4">
      <div className="min-w-0">
        {eyebrow ? (
          <span className="font-mono text-[11px] font-bold text-accent uppercase tracking-wider block mb-1">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="text-xl font-bold tracking-tight text-ink font-sans">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-xs text-ink-muted leading-relaxed">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

type Tone = 'neutral' | 'accent' | 'iris' | 'good' | 'warning' | 'critical' | 'teal';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-edge-strong bg-canvas-overlay text-ink-muted',
  accent: 'border-accent/40 bg-accent-wash text-accent-soft',
  iris: 'border-indigo/40 bg-indigo-wash text-indigo',
  teal: 'border-teal/40 bg-teal-wash text-teal-soft',
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
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  const dot: Record<Tone, string> = {
    neutral: 'bg-status-neutral',
    accent: 'bg-accent',
    iris: 'bg-indigo',
    teal: 'bg-teal',
    good: 'bg-status-good',
    warning: 'bg-status-warning',
    critical: 'bg-status-critical',
  };
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs text-ink-muted">
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot[tone])} />
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
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center rounded border border-edge-subtle bg-canvas-sunken/40">
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-ink">{title}</p>
      <p className="max-w-md text-xs text-ink-muted leading-relaxed">{description}</p>
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
    <div className="overflow-x-auto border border-edge rounded">
      <table className="w-full min-w-[640px] border-collapse text-xs">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-edge bg-canvas-sunken/80">
            {headers.map((header) => {
              const label = typeof header === 'string' ? header : header.label;
              const align = typeof header === 'string' ? 'left' : (header.align ?? 'left');
              return (
                <th
                  key={label}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-3.5 py-2.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-ink-faint',
                    align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-edge-subtle bg-canvas-raised">{children}</tbody>
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
        'px-3.5 py-2.5 align-middle text-ink-muted text-xs',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'font-mono text-[12px] tabular-nums',
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
          <dt className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-ink-faint">{item.term}</dt>
          <dd className="mt-0.5 break-words text-xs text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InlineNote({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const border: Record<Tone, string> = {
    neutral: 'border-l-edge-strong',
    accent: 'border-l-accent',
    iris: 'border-l-indigo',
    teal: 'border-l-teal',
    good: 'border-l-status-good',
    warning: 'border-l-status-warning',
    critical: 'border-l-status-critical',
  };
  return (
    <div
      className={cn(
        'rounded-r border-l-2 bg-canvas-sunken px-3.5 py-2.5 text-xs text-ink-muted',
        border[tone],
      )}
    >
      {children}
    </div>
  );
}
