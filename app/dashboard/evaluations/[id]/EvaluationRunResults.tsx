'use client';

import { useState, useEffect } from 'react';
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';
import { formatRelative } from '@/lib/ui';

interface Run {
  id: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface Evaluation {
  id: string;
  testCases: Array<{
    id: string;
    question: string;
    role: string;
    expectedBehavior: string;
    expectedSourceDocuments?: string[];
    expectedConcepts?: string[];
  }>;
}

interface CaseResult {
  testCaseId: string;
  classification: string;
  confidence: number;
  grounding: string;
  citations: number;
  latencyMs: number;
  retrievedDocuments: string[];
  vectorCandidates: number;
  keywordCandidates: number;
  fusedCandidates: number;
  accessFilterSurvivors: number;
  rerankedChunks: number;
  details: string;
  answer: string;
  traceId: string;
  provider: string;
  model: string;
}

export function EvaluationRunResults({
  run,
  evaluation,
  onClose,
}: {
  run: Run;
  evaluation: Evaluation;
  onClose: () => void;
}) {
  const [results, setResults] = useState<CaseResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadResults() {
      try {
        const response = await fetch(`/api/evaluations/${evaluation.id}/run?runId=${run.id}`);
        const data = await response.json();
        if (data.ok && data.results) {
          setResults(data.results);
        } else if (run.error) {
          try {
            const parsed = JSON.parse(run.error);
            if (parsed.results) {
              setResults(parsed.results);
            }
          } catch {
            // error is just a string
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadResults();
  }, [run.id, evaluation.id, run.error]);

  if (loading) {
    return (
      <Panel>
        <PanelHeader title="Loading results…" />
        <div className="p-8 text-center text-ink-faint">Loading run details…</div>
      </Panel>
    );
  }

  const classificationTones: Record<string, 'good' | 'warning' | 'critical' | 'accent' | 'neutral'> = {
    PASS: 'good',
    RETRIEVAL_MISS: 'critical',
    WRONG_SOURCE: 'critical',
    UNSUPPORTED_EXPECTED: 'critical',
    UNSAFE_ACCESS: 'critical',
    CITATION_FAILURE: 'critical',
    GROUNDING_FAILURE: 'critical',
    ANSWER_CONCEPT_MISS: 'critical',
    LATENCY_FAILURE: 'warning',
    PROVIDER_FAILURE: 'critical',
  };

  return (
    <Panel>
      <PanelHeader
        title="Run Results"
        action={
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent"
          >
            Close
          </button>
        }
      />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div>
            <span className="text-ink-faint block">Total</span>
            <span className="font-medium text-ink mono">{run.total}</span>
          </div>
          <div>
            <span className="text-ink-faint block">Passed</span>
            <span className="font-medium text-ink mono text-emerald">{run.passed}</span>
          </div>
          <div>
            <span className="text-ink-faint block">Failed</span>
            <span className="font-medium text-ink mono text-rose">{run.failed}</span>
          </div>
          <div>
            <span className="text-ink-faint block">Duration</span>
            <span className="font-medium text-ink mono">{run.durationMs ?? 0} ms</span>
          </div>
          <div>
            <span className="text-ink-faint block">Completed</span>
            <span className="font-medium text-ink">{run.completedAt ? formatRelative(run.completedAt) : '—'}</span>
          </div>
        </div>

        {results.length === 0 ? (
          <EmptyState title="No detailed results" description="Results may not be available for older runs." />
        ) : (
          <DataTable
            caption="Test case results"
            headers={['Test Case', 'Classification', 'Grounding', 'Confidence', 'Citations', 'Latency', 'Details']}
          >
            {results.map((result) => {
              const tc = evaluation.testCases.find((t) => t.id === result.testCaseId);
              return (
                <tr key={result.testCaseId}>
                  <Cell className="max-w-md">
                    <span className="font-medium text-ink truncate block">{tc?.question ?? result.testCaseId}</span>
                    <span className="text-xs text-ink-faint">{tc?.role}</span>
                  </Cell>
                  <Cell>
                    <Badge tone={classificationTones[result.classification] ?? 'neutral'}>
                      {result.classification}
                    </Badge>
                  </Cell>
                  <Cell>
                    <Badge tone={result.grounding === 'SUPPORTED' ? 'good' : result.grounding === 'PARTIALLY_SUPPORTED' ? 'warning' : 'critical'}>
                      {result.grounding}
                    </Badge>
                  </Cell>
                  <Cell className="mono">{(result.confidence * 100).toFixed(1)}%</Cell>
                  <Cell className="mono">{result.citations}</Cell>
                  <Cell className="mono">{result.latencyMs} ms</Cell>
<Cell className="text-xs text-ink-faint max-w-xs truncate">
                      {result.details}
                    </Cell>
                </tr>
              );
            })}
          </DataTable>
        )}

        {results.length > 0 && (
          <details className="border border-edge rounded-lg">
            <summary className="p-4 cursor-pointer font-medium text-ink">Raw Pipeline Metrics</summary>
            <div className="p-4 space-y-2 text-xs font-mono text-ink-faint">
              {results.map((r) => (
                <div key={r.testCaseId} className="border-t border-edge pt-2">
                  <div className="font-medium text-ink">{r.testCaseId}</div>
                  <div>Vector candidates: {r.vectorCandidates}</div>
                  <div>Keyword candidates: {r.keywordCandidates}</div>
                  <div>Fused candidates: {r.fusedCandidates}</div>
                  <div>Access filter survivors: {r.accessFilterSurvivors}</div>
                  <div>Reranked chunks: {r.rerankedChunks}</div>
                  <div>Retrieved docs: {r.retrievedDocuments.join(', ') || '—'}</div>
                  <div>Provider: {r.provider} / {r.model}</div>
                  <div>Trace ID: {r.traceId}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </Panel>
  );
}