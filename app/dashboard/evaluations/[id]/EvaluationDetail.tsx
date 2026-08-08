'use client';

import { useState } from 'react';
import Link from 'next/link';
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
import { EvaluationRunResults } from './EvaluationRunResults';

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
    permittedRole?: string;
    expectedGrounding?: string;
    minimumConfidence?: number;
    maximumLatencyMs?: number;
    history?: Array<{ role: string; content: string }>;
  }>;
  knowledgeBase: { id: string; name: string } | null;
  runs: Array<{
    id: string;
    status: string;
    total: number;
    passed: number;
    failed: number;
    error: string | null;
    durationMs: number | null;
    createdAt: string;
    completedAt: string | null;
    evaluation: { name: string } | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export function EvaluationDetail({ evaluation }: { evaluation: Evaluation }) {
  const [selectedRun, setSelectedRun] = useState<(typeof evaluation.runs)[0] | null>(null);

  const canManage = true; // Would check permissions in real implementation

  return (
    <>
      <PageHeader
        title={evaluation.name}
        description={evaluation.description ?? undefined}
        action={
          canManage ? (
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/evaluations/${evaluation.id}/edit`}
                className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent"
              >
                Edit
              </Link>
              <Link
                href={`/dashboard/evaluations/${evaluation.id}/run`}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-ink-inverse transition hover:bg-accent-soft"
              >
                Run
              </Link>
            </div>
          ) : null
        }
      />

      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Configuration" />
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
                <span className="text-ink-faint block">Created</span>
                <span className="font-medium text-ink">{formatRelative(evaluation.createdAt)}</span>
              </div>
              <div>
                <span className="text-ink-faint block">Updated</span>
                <span className="font-medium text-ink">{formatRelative(evaluation.updatedAt)}</span>
              </div>
            </div>

            <div className="border-t border-edge pt-4">
              <h4 className="font-medium text-ink mb-3">Test Cases</h4>
              <DataTable
                caption="Test cases in this evaluation"
                headers={[
                  'Question',
                  'Role',
                  'Expected',
                  'Expected Sources',
                  'Concepts',
                  'Min Confidence',
                  'Max Latency',
                ]}
              >
                {evaluation.testCases.map((tc) => (
                  <tr key={tc.id}>
                    <Cell className="max-w-md truncate">
                      <span className="font-medium text-ink">{tc.question}</span>
                    </Cell>
                    <Cell>
                      <Badge tone="neutral">{tc.role}</Badge>
                    </Cell>
                    <Cell>
                      <Badge tone={tc.expectedBehavior === 'SHOULD_ANSWER' ? 'good' : 'warning'}>
                        {tc.expectedBehavior === 'SHOULD_ANSWER' ? 'Answer' : 'Refuse'}
                      </Badge>
                    </Cell>
                    <Cell className="text-xs">{tc.expectedSourceDocuments?.join(', ') ?? '—'}</Cell>
                    <Cell className="text-xs">{tc.expectedConcepts?.join(', ') ?? '—'}</Cell>
                    <Cell className="mono text-xs">
                      {tc.minimumConfidence ? `${(tc.minimumConfidence * 100).toFixed(0)}%` : '—'}
                    </Cell>
                    <Cell className="mono text-xs">
                      {tc.maximumLatencyMs ? `${tc.maximumLatencyMs}ms` : '—'}
                    </Cell>
                  </tr>
                ))}
              </DataTable>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Run History" />
          {evaluation.runs.length === 0 ? (
            <EmptyState
              title="No runs yet"
              description="Run this evaluation to see results and track regressions."
              action={
                <Link
                  href={`/dashboard/evaluations/${evaluation.id}/run`}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
                >
                  Run Evaluation
                </Link>
              }
            />
          ) : (
            <>
              <DataTable
                caption="Previous runs"
                headers={['Status', 'Result', 'Passed', 'Failed', 'Duration', 'Started', 'Actions']}
              >
                {evaluation.runs.map((run) => (
                  <tr key={run.id}>
                    <Cell>
                      <Badge
                        tone={
                          run.status === 'COMPLETED'
                            ? run.passed === run.total
                              ? 'good'
                              : run.passed > 0
                                ? 'warning'
                                : 'critical'
                            : run.status === 'RUNNING'
                              ? 'accent'
                              : 'neutral'
                        }
                      >
                        {run.status}
                      </Badge>
                    </Cell>
                    <Cell>
                      {run.status === 'COMPLETED' ? (
                        <Badge
                          tone={
                            run.passed === run.total
                              ? 'good'
                              : run.passed > 0
                                ? 'warning'
                                : 'critical'
                          }
                        >
                          {run.passed === run.total
                            ? 'Passed'
                            : run.passed > 0
                              ? 'Partial'
                              : 'Failed'}
                        </Badge>
                      ) : (
                        <span className="text-ink-faint">{run.status}</span>
                      )}
                    </Cell>
                    <Cell className="mono">{run.passed}</Cell>
                    <Cell className="mono">{run.failed}</Cell>
                    <Cell className="mono">{run.durationMs ?? 0} ms</Cell>
                    <Cell>
                      <span className="text-xs text-ink-faint">
                        {formatRelative(run.createdAt)}
                      </span>
                    </Cell>
                    <Cell align="right">
                      <Link
                        href={`/dashboard/evaluations/${evaluation.id}/run?runId=${run.id}`}
                        className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent"
                      >
                        View
                      </Link>
                    </Cell>
                  </tr>
                ))}
              </DataTable>

              {selectedRun && (
                <div className="border-t border-edge pt-4 mt-4">
                  <EvaluationRunResults
                    run={selectedRun}
                    evaluation={evaluation}
                    onClose={() => setSelectedRun(null)}
                  />
                </div>
              )}
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
