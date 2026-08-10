'use client';

import { cn } from '@/lib/ui';
import type { Citation } from './types';

export function CitationCard({
  citation,
  onOpen,
  compact,
  highlighted,
  onHover,
}: {
  citation: Citation;
  onOpen?: (citation: Citation) => void;
  compact?: boolean;
  highlighted?: boolean;
  onHover?: (ordinal: number | null) => void;
}) {
  const location = [
    citation.sectionTitle,
    citation.pageNumber !== null ? `Page ${citation.pageNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const Wrapper = onOpen ? 'button' : 'div';

  return (
    <Wrapper
      {...(onOpen ? { type: 'button' as const, onClick: () => onOpen(citation) } : {})}
      onMouseEnter={() => onHover?.(citation.ordinal)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        'group w-full rounded border text-left transition-all duration-150 p-3',
        highlighted
          ? 'border-teal bg-teal-wash/20 shadow-sm'
          : 'border-edge bg-canvas-sunken hover:border-accent/50 hover:bg-canvas-overlay',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
            highlighted ? 'bg-teal text-ink-inverse' : 'bg-accent-wash text-accent-soft border border-accent/20',
          )}
          aria-hidden="true"
        >
          {citation.ordinal}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-semibold text-ink font-sans">{citation.documentTitle}</p>
            {citation.accessLevel ? (
              <span className="font-mono text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-edge bg-canvas-raised text-ink-faint shrink-0">
                {citation.accessLevel}
              </span>
            ) : null}
          </div>
          {location ? <p className="mt-0.5 truncate font-mono text-[10.5px] text-ink-faint">{location}</p> : null}
          {!compact ? (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-muted italic border-l border-teal/40 pl-2">
              &ldquo;{citation.excerpt}&rdquo;
            </p>
          ) : null}
        </div>
      </div>
    </Wrapper>
  );
}
