'use client';

import { useEffect, useRef } from 'react';
import type { Citation } from './types';

/**
 * Source drawer.
 *
 * Opens the full excerpt behind a citation. Implemented as a focus-trapping
 * dialog: Escape closes it, focus moves in on open and returns to the trigger
 * on close, and the backdrop is inert to screen readers.
 */
export function SourceDrawer({
  citation,
  onClose,
}: {
  citation: Citation | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!citation) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previouslyFocused.current?.focus();
    };
  }, [citation, onClose]);

  if (!citation) return null;

  const location = [
    citation.sectionTitle,
    citation.pageNumber !== null ? `Page ${citation.pageNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-canvas-sunken/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-drawer-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col border-l border-edge bg-canvas-raised shadow-lift focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              Source {citation.ordinal}
            </p>
            <h2 id="source-drawer-title" className="mt-1 text-sm font-semibold text-ink">
              {citation.documentTitle}
            </h2>
            {location ? <p className="mt-0.5 text-xs text-ink-faint">{location}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-muted transition hover:bg-canvas-overlay hover:text-ink"
            aria-label="Close source panel"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Retrieved passage
          </p>
          <blockquote className="mt-3 border-l-2 border-accent/40 pl-4 text-sm leading-relaxed text-ink">
            {citation.excerpt}
          </blockquote>

          <div className="mt-6 rounded-md border border-edge bg-canvas-sunken p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Relevance
            </p>
            <p className="mt-1.5 font-mono text-sm text-ink">
              {(citation.relevanceScore * 100).toFixed(1)}%
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              Combined rerank score from term coverage, proximity, term rarity and heading match.
              This measures how well the passage matched the question, not whether the answer is
              correct.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
