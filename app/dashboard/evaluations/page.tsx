import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Evaluations' };
export const dynamic = 'force-dynamic';

export default async function EvaluationsPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'evaluation:read')) {
    return <AccessDenied area="evaluations" />;
  }

  const knowledgeBases = await prisma.knowledgeBase.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const [evaluations, runs] = await Promise.all([
    prisma.evaluation.findMany({
      where: { knowledgeBaseId: { in: knowledgeBases.map((kb) => kb.id) } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        knowledgeBase: { select: { name: true } },
        runs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    }),
    prisma.evaluationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        evaluation: { select: { name: true, knowledgeBase: { select: { name: true } } } },
      },
    }),
  ]);

  const canManage = hasPermission(session.role, 'evaluation:manage');

  return (
    <>
      <PageHeader
        title="Evaluation Workbench"
        description="Define test cases and run them against your knowledge bases to regression-test retrieval and answer quality."
        action={
          canManage ? (
            <a
              href="/dashboard/evaluations/new"
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
            >
              Create evaluation
            </a>
          ) : null
        }
      />

      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Evaluations" />
          {evaluations.length === 0 ? (
            <EmptyState
              title="No evaluations yet"
              description="Create your first evaluation to start regression-testing your RAG pipeline."
              action={
                canManage ? (
                  <a
                    href="/dashboard/evaluations/new"
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
                  >
                    Create evaluation
                  </a>
                ) : null
              }
            />
          ) : (
            <DataTable
              caption="Evaluation suites"
              headers={[
                'Name',
                'Knowledge Base',
                'Test Cases',
                'Last Run',
                'Last Result',
                { label: 'Actions', align: 'right' },
              ]}
            >
              {evaluations.map((evaluation) => (
                <tr key={evaluation.id}>
                  <Cell>
                    <a
                      href={`/dashboard/evaluations/${evaluation.id}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {evaluation.name}
                    </a>
                    {evaluation.description ? (
                      <span className="mt-0.5 block max-w-md text-xs text-ink-faint">
                        {evaluation.description}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell>{evaluation.knowledgeBase?.name ?? '—'}</Cell>
                  <Cell className="mono">
                    {Array.isArray(evaluation.testCases) ? evaluation.testCases.length : 0}
                  </Cell>
                  <Cell>
                    {evaluation.runs[0] ? (
                      formatRelative(evaluation.runs[0].createdAt)
                    ) : (
                      <span className="text-ink-faint">Never</span>
                    )}
                  </Cell>
                  <Cell>
                    {evaluation.runs[0] ? (
                      <Badge
                        tone={
                          evaluation.runs[0].passed === evaluation.runs[0].total
                            ? 'good'
                            : 'critical'
                        }
                      >
                        {evaluation.runs[0].passed} / {evaluation.runs[0].total}
                      </Badge>
                    ) : (
                      <span className="text-xs text-ink-faint">No runs yet</span>
                    )}
                  </Cell>
                  <Cell align="right">
                    <div className="flex items-center gap-1">
                      <a
                        href={`/dashboard/evaluations/${evaluation.id}/run`}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-ink-inverse transition hover:bg-accent-soft"
                      >
                        Run
                      </a>
                      <a
                        href={`/dashboard/evaluations/${evaluation.id}/edit`}
                        className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent"
                      >
                        Edit
                      </a>
                    </div>
                  </Cell>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Recent Runs" />
          {runs.length === 0 ? (
            <EmptyState title="No runs yet" description="Run an evaluation to see results here." />
          ) : (
            <DataTable
              caption="Recent evaluation runs"
              headers={['Evaluation', 'Knowledge Base', 'Result', 'Passed', 'Duration', 'Started']}
            >
              {runs.map((run) => (
                <tr key={run.id}>
                  <Cell>
                    <a
                      href={`/dashboard/evaluations/${run.evaluationId}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {run.evaluation?.name ?? 'Unknown'}
                    </a>
                  </Cell>
                  <Cell>{run.evaluation?.knowledgeBase?.name ?? '—'}</Cell>
                  <Cell>
                    <Badge
                      tone={
                        run.passed === run.total ? 'good' : run.passed > 0 ? 'warning' : 'critical'
                      }
                    >
                      {run.passed === run.total ? 'Passed' : run.passed > 0 ? 'Partial' : 'Failed'}
                    </Badge>
                  </Cell>
                  <Cell className="mono">
                    {run.passed} / {run.total}
                  </Cell>
                  <Cell className="mono">{run.durationMs ?? 0} ms</Cell>
                  <Cell>
                    <span className="text-xs text-ink-faint">{formatRelative(run.createdAt)}</span>
                  </Cell>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
