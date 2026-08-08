'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/ui';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/ui';

interface IntegrationTestButtonProps {
  integrationId: string;
  _integrationName?: string;
}

const buttonStyles = cn(
  'rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink',
  'transition hover:border-accent hover:text-accent',
  'disabled:opacity-50 disabled:cursor-not-allowed',
);

export function IntegrationTestButton({
  integrationId,
  _integrationName,
}: IntegrationTestButtonProps) {
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<{
    status: string;
    detail: string;
    latencyMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    setStatus('testing');
    setError(null);
    setResult(null);

    try {
      const result = await apiFetch<{
        integration: {
          id: string;
          name: string;
          type: string;
          status: string;
          detail: string;
          latencyMs: number;
          checkedAt: string;
        };
      }>(`/api/integrations/${integrationId}/test`, {
        method: 'POST',
      });

      if (!result.ok) {
        setStatus('error');
        setError(result.error);
      } else {
        setStatus('success');
        setResult({
          status: result.data.integration.status,
          detail: result.data.integration.detail,
          latencyMs: result.data.integration.latencyMs,
        });
      }
    } catch {
      setStatus('error');
      setError('Test request failed');
    }
  };

  return (
    <div className="flex items-center gap-2">
      {status === 'idle' && (
        <button type="button" className={buttonStyles} onClick={handleTest}>
          Test connection
        </button>
      )}

      {status === 'testing' && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="flex gap-1" aria-hidden="true">
            <span
              className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent"
              style={{ animationDelay: '160ms' }}
            />
            <span
              className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent"
              style={{ animationDelay: '320ms' }}
            />
          </span>
          <span>Testing…</span>
        </div>
      )}

      {status === 'success' && result && (
        <div className="flex items-center gap-2">
          <Badge
            tone={
              result.status === 'CONNECTED'
                ? 'good'
                : result.status === 'ERROR'
                  ? 'critical'
                  : 'warning'
            }
          >
            {result.status}
          </Badge>
          <span className="text-xs text-ink-muted">
            {result.detail} ({result.latencyMs}ms)
          </span>
          <button type="button" className={buttonStyles} onClick={() => setStatus('idle')}>
            Retest
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-2">
          <Badge tone="critical">Failed</Badge>
          <span className="text-xs text-status-critical">{error}</span>
          <button type="button" className={buttonStyles} onClick={() => setStatus('idle')}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
