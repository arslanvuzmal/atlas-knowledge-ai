'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/lib/ui';
import { ACCESS_LEVEL_LABELS } from '@/lib/auth/rbac';
import type { AccessLevel } from '@prisma/client';

interface DocumentActionsProps {
  documentId: string;
  accessLevel: AccessLevel;
  archived: boolean;
  assignableLevels: AccessLevel[];
  can: {
    reprocess: boolean;
    archive: boolean;
    changeAccess: boolean;
    delete: boolean;
  };
}

export function DocumentActions({
  documentId,
  accessLevel,
  archived,
  assignableLevels,
  can,
}: DocumentActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [level, setLevel] = useState<AccessLevel>(accessLevel);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function reprocess() {
    setBusy('reprocess');
    setMessage(null);
    const result = await apiFetch<{ documentId: string; chunkCount: number }>(
      `/api/documents/${documentId}/reprocess`,
      { method: 'POST' },
    );
    setBusy(null);

    if (!result.ok) {
      setMessage({ tone: 'bad', text: result.error });
      return;
    }
    // Reprocessing rebuilds the record, so the id changes.
    router.push(`/dashboard/documents/${result.data.documentId}`);
    router.refresh();
  }

  async function changeAccess(next: AccessLevel) {
    setBusy('access');
    setMessage(null);
    const result = await apiFetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ accessLevel: next }),
    });
    setBusy(null);

    if (!result.ok) {
      setMessage({ tone: 'bad', text: result.error });
      setLevel(accessLevel);
      return;
    }
    setLevel(next);
    setMessage({
      tone: 'good',
      text: `Access level changed to ${ACCESS_LEVEL_LABELS[next]}. Every passage was updated.`,
    });
    router.refresh();
  }

  async function toggleArchive() {
    setBusy('archive');
    setMessage(null);
    const result = await apiFetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: !archived }),
    });
    setBusy(null);

    if (!result.ok) {
      setMessage({ tone: 'bad', text: result.error });
      return;
    }
    router.refresh();
  }

  async function remove() {
    setBusy('delete');
    const result = await apiFetch(`/api/documents/${documentId}`, { method: 'DELETE' });
    setBusy(null);

    if (!result.ok) {
      setMessage({ tone: 'bad', text: result.error });
      return;
    }
    router.push('/dashboard/documents');
    router.refresh();
  }

  const button =
    'rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-edge-strong hover:text-ink disabled:opacity-60';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {can.reprocess ? (
          <button type="button" className={button} onClick={reprocess} disabled={busy !== null}>
            {busy === 'reprocess' ? 'Reprocessing…' : 'Reprocess'}
          </button>
        ) : null}

        {can.archive ? (
          <button type="button" className={button} onClick={toggleArchive} disabled={busy !== null}>
            {busy === 'archive' ? 'Working…' : archived ? 'Restore' : 'Archive'}
          </button>
        ) : null}

        {can.delete ? (
          confirmDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-status-critical">Delete permanently?</span>
              <button
                type="button"
                onClick={remove}
                disabled={busy !== null}
                className="rounded-md border border-status-critical/50 px-3 py-1.5 text-xs font-medium text-status-critical transition hover:bg-status-critical/10 disabled:opacity-60"
              >
                {busy === 'delete' ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button type="button" className={button} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={button}
              onClick={() => setConfirmDelete(true)}
              disabled={busy !== null}
            >
              Delete
            </button>
          )
        ) : null}
      </div>

      {can.changeAccess ? (
        <div>
          <label htmlFor="access-level" className="mb-1.5 block text-xs font-medium text-ink">
            Access level
          </label>
          <select
            id="access-level"
            value={level}
            disabled={busy !== null}
            onChange={(event) => changeAccess(event.target.value as AccessLevel)}
            className="field max-w-xs py-1.5 text-sm"
          >
            {assignableLevels.map((option) => (
              <option key={option} value={option}>
                {ACCESS_LEVEL_LABELS[option]}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Changing this immediately updates every passage, so retrieval reflects it on the next
            question.
          </p>
        </div>
      ) : null}

      {message ? (
        <p
          role="status"
          className={
            message.tone === 'good' ? 'text-xs text-status-good' : 'text-xs text-status-critical'
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** Runs a retrieval probe against one document and shows the ranked passages. */
export function DocumentQueryTester({ documentId }: { documentId: string }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    confidence: number;
    grounding: string;
    matches: {
      chunkId: string;
      chunkIndex: number;
      sectionTitle: string | null;
      pageNumber: number | null;
      rerankScore: number;
      preview: string;
    }[];
  } | null>(null);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length === 0) return;
    setBusy(true);
    setError(null);

    const response = await apiFetch<typeof result & object>(
      `/api/documents/${documentId}/test-query`,
      { method: 'POST', body: JSON.stringify({ query }) },
    );
    setBusy(false);

    if (!response.ok) {
      setError(response.error);
      setResult(null);
      return;
    }
    setResult(response.data as NonNullable<typeof result>);
  }

  return (
    <div>
      <form onSubmit={run} className="flex flex-wrap gap-2">
        <label htmlFor="test-query" className="sr-only">
          Test a question against this document
        </label>
        <input
          id="test-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask something this document should answer…"
          className="field flex-1 min-w-[240px]"
        />
        <button
          type="submit"
          disabled={busy || query.trim().length === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-60"
        >
          {busy ? 'Testing…' : 'Test retrieval'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-status-critical">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4">
          <p className="text-xs text-ink-muted">
            Confidence{' '}
            <span className="font-mono text-ink">{(result.confidence * 100).toFixed(1)}%</span> ·
            grounding <span className="font-mono text-ink">{result.grounding}</span> ·{' '}
            {result.matches.length} passage{result.matches.length === 1 ? '' : 's'} matched
          </p>

          {result.matches.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No passage in this document matched. This is what an unsupported answer looks like.
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {result.matches.map((match) => (
                <li
                  key={match.chunkId}
                  className="rounded-md border border-edge bg-canvas-sunken p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-ink">
                      {match.sectionTitle ?? `Passage ${match.chunkIndex + 1}`}
                      {match.pageNumber !== null ? (
                        <span className="text-ink-faint"> · page {match.pageNumber}</span>
                      ) : null}
                    </p>
                    <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                      {(match.rerankScore * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink-muted">
                    {match.preview}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
