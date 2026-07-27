'use client';

import { cn } from '@/lib/ui';
import type { Citation } from './types';

/**
 * Citation card.
 *
 * Shows exactly what the answer was built from: the document, the section, the
 * page, and the verbatim excerpt. The ordinal matches the bracketed marker in
 * the answer text, so a reader can trace any sentence back to its evidence.
 */
export function CitationCard({
  citation,
  onOpen,
  compact,
}: {
  citation: Citation;
  onOpen?: (citation: Citation) => void;
  compact?: boolean;
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
      className={cn(
        'group w-full rounded-md border border-edge bg-canvas-sunken p-3 text-left transition',
        onOpen && 'hover:border-accent/50 hover:bg-canvas-overlay',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-wash font-mono text-[11px] font-semibold text-accent-soft"
          aria-hidden="true"
        >
          {citation.ordinal}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{citation.documentTitle}</p>
          {location ? <p className="mt-0.5 truncate text-xs text-ink-faint">{location}</p> : null}
          {!compact ? (
            <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-ink-muted">
              {citation.excerpt}
            </p>
          ) : null}
        </div>
      </div>
    </Wrapper>
  );
}
