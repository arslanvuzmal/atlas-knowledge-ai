'use client';

import { useEffect } from 'react';
import { PageHeader, Panel } from '@/components/ui/primitives';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard Route Error:', error);
  }, [error]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard View Notice"
        description="An isolated error occurred while rendering this workspace view."
      />

      <Panel className="p-6 border-status-bad/40 bg-status-bad/10 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-status-bad">Execution Notice</h2>
          <p className="text-xs font-mono text-ink mt-1">
            {error.message || 'A server-side exception occurred while rendering this view.'}
          </p>
          {error.digest ? (
            <p className="text-[10px] font-mono text-ink-faint mt-1">
              Error Digest: {error.digest}
            </p>
          ) : null}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => reset()}
            className="rounded bg-accent px-3 py-1.5 font-mono text-xs font-bold text-ink-inverse hover:bg-accent-soft transition"
          >
            Retry Loading View
          </button>
          <a
            href="/dashboard"
            className="rounded border border-edge px-3 py-1.5 font-mono text-xs font-bold text-ink hover:bg-canvas-overlay transition"
          >
            Return to Dashboard
          </a>
        </div>
      </Panel>
    </div>
  );
}
