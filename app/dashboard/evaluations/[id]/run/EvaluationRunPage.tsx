'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/ui';
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';
import { formatRelative } from '@/lib/ui';
import { useToast } from '@/components/ui/toast';

interface Evaluation {
  id: string;
  name: string;
  description: string | null;
  testCases: Array<{
    id: string;
    question: string;
    role: string;
    expectedBehavior: string;
    expectedSourceDocuments?: string[];
    expectedConcepts?: string[];
  }>;
  knowledgeBase: { id: string; name: string } | null;
}

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

export function EvaluationRunPage({ evaluation }: { evaluation: Evaluation }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<CaseResult[]>([]);

  useEffect(() => {
    if (run && run.status === 'RUNNING') {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(`/api/evaluations/${evaluation.id}/run?runId=${run.id}`);
          const data = await response.json();
          if (data.ok && data.run) {
            setRun(data.run);
            if (data.results) {
              setResults(data.results);
            }
            if (data.run.status === 'COMPLETED' || data.run.status === 'FAILED') {
              if (data.results) {
                setResults(data.results);
              }
            }
          }
        } catch {
          // ignore polling errors
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [run, evaluation.id]);

  async function handleRun() {
    setRunning(true);
    try {
      const response = await fetch(`/api/evaluations/${evaluation.id}/run`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        showToast({ type: 'error', message: data.error ?? 'Failed to start evaluation run' });
        return;
      }
      setRun(data.run);
      if (data.results) {
        setResults(data.results);
      }
    } catch {
      showToast({ type: 'error', message: 'Network error' });
    } finally {
      setRunning(false);
    }
  }

  const canManage = true;

  return (
    <>
      <PageHeader
        title={`Run: ${evaluation.name}`}
        description="Execute this evaluation against the current RAG pipeline configuration."
        action={
          canManage ? (
            <Link
              href={`/dashboard/evaluations/${evaluation.id}`}
              className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent"
            >
              Back to Evaluation
            </Link>
          ) : null
        }
      />

      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Configuration Snapshot" />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-ink-faint block">Knowledge Base</span>
                <span className="font-medium text-ink">
                  {evaluation.knowledgeBase?.name ?? '—'}
                </span>
              </div>
              <div>
                <span className="text-ink-faint block">Test Cases</span>
                <span className="font-medium text-ink mono">{evaluation.testCases.length}</span>
              </div>
              <div>
                <span className="text-ink-faint block">Embedding Provider</span>
                <span className="font-medium text-ink mono">
                  {process.env.NEXT_PUBLIC_EMBEDDING_PROVIDER ?? 'demo'}
                </span>
              </div>
              <div>
                <span className="text-ink-faint block">LLM Provider</span>
                <span className="font-medium text-ink mono">
                  {process.env.NEXT_PUBLIC_LLM_PROVIDER ?? 'demo'}
                </span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title={run ? `Run ${run.id.slice(0, 8)}…` : 'Execute Evaluation'}
            action={
              run && run.status === 'RUNNING' ? (
                <span className="flex items-center gap-2 text-sm text-accent">
                  <span className="animate-pulse rounded-full bg-accent h-2 w-2" />
                  Running…
                </span>
              ) : run ? (
                <Badge
                  tone={
                    run.status === 'COMPLETED'
                      ? run.passed === run.total
                        ? 'good'
                        : run.passed > 0
                          ? 'warning'
                          : 'critical'
                      : 'neutral'
                  }
                >
                  {run.status}
                </Badge>
              ) : (
                <button
                  onClick={handleRun}
                  disabled={running}
                  className={cn(
                    'rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  {running ? 'Starting…' : 'Run Evaluation'}
                </button>
              )
            }
          />
          <div className="p-4">
            {run ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm mb-4">
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
                    <span className="text-ink-faint block">Started</span>
                    <span className="font-medium text-ink">{formatRelative(run.createdAt)}</span>
                  </div>
                </div>

                {results.length === 0 && run.status !== 'COMPLETED' && run.status !== 'FAILED' ? (
                  <EmptyState
                    title="Running…"
                    description="Test cases are being executed against the pipeline."
                  />
                ) : results.length === 0 ? (
                  <EmptyState
                    title="No results"
                    description="Results will appear here when the run completes."
                  />
                ) : (
                  <>
                    <DataTable
                      caption="Test case results"
                      headers={[
                        'Test Case',
                        'Classification',
                        'Grounding',
                        'Confidence',
                        'Citations',
                        'Latency',
                        'Details',
                      ]}
                    >
                      {results.map((result) => {
                        const tc = evaluation.testCases.find((t) => t.id === result.testCaseId);
                        return (
                          <tr key={result.testCaseId}>
                            <Cell className="max-w-md">
                              <span className="font-medium text-ink truncate block">
                                {tc?.question ?? result.testCaseId}
                              </span>
                              <span className="text-xs text-ink-faint">{tc?.role}</span>
                            </Cell>
                            <Cell>
                              <Badge
                                tone={
                                  result.classification === 'PASS'
                                    ? 'good'
                                    : result.classification === 'LATENCY_FAILURE'
                                      ? 'warning'
                                      : 'critical'
                                }
                              >
                                {result.classification}
                              </Badge>
                            </Cell>
                            <Cell>
                              <Badge
                                tone={
                                  result.grounding === 'SUPPORTED'
                                    ? 'good'
                                    : result.grounding === 'PARTIALLY_SUPPORTED'
                                      ? 'warning'
                                      : 'critical'
                                }
                              >
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

                    <details className="border border-edge rounded-lg mt-4">
                      <summary className="p-4 cursor-pointer font-medium text-ink">
                        Raw Pipeline Metrics
                      </summary>
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
                            <div>
                              Provider: {r.provider} / {r.model}
                            </div>
                            <div>Trace ID: {r.traceId}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  </>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-4 border border-edge rounded-lg">
                  <h4 className="font-medium text-ink mb-2">Test cases to be executed:</h4>
                  <ul className="space-y-1 text-sm">
                    {evaluation.testCases.slice(0, 10).map((tc) => (
                      <li key={tc.id} className="flex gap-2">
                        <Badge tone="neutral" className="shrink-0">
                          {tc.role}
                        </Badge>
                        <span className="truncate">{tc.question}</span>
                        <Badge tone={tc.expectedBehavior === 'SHOULD_ANSWER' ? 'good' : 'warning'}>
                          {tc.expectedBehavior === 'SHOULD_ANSWER' ? 'Answer' : 'Refuse'}
                        </Badge>
                      </li>
                    ))}
                    {evaluation.testCases.length > 10 && (
                      <li className="text-ink-faint">
                        … and {evaluation.testCases.length - 10} more
                      </li>
                    )}
                  </ul>
                </div>
                <p className="text-sm text-ink-faint">
                  This will execute all {evaluation.testCases.length} test cases against the current
                  retrieval and generation pipeline. Results will be stored for comparison with
                  future runs.
                </p>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
