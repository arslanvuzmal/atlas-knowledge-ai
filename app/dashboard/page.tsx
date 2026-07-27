import Link from 'next/link';
import { PageHeader, Panel, PanelHeader, Badge, InlineNote } from '@/components/ui/primitives';
import { StatTile, SegmentedBar, ActivityChart, BarList } from '@/components/dashboard/charts';
import { getSession } from '@/lib/auth/session';
import { hasPermission, ACCESS_LEVEL_LABELS, allowedAccessLevels } from '@/lib/auth/rbac';
import {
  getDailyActivity,
  getMostUsedDocuments,
  getOverviewMetrics,
} from '@/lib/analytics/metrics';
import { env } from '@/lib/env';
import { formatNumber, formatPercent } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
  const session = await getSession();
  const canSeeAnalytics = hasPermission(session.role, 'analytics:view');

  const [metrics, activity, topDocuments] = await Promise.all([
    getOverviewMetrics(),
    getDailyActivity(14),
    canSeeAnalytics ? getMostUsedDocuments(5) : Promise.resolve([]),
  ]);

  const reach = allowedAccessLevels(session.role)
    .map((level) => ACCESS_LEVEL_LABELS[level])
    .join(' · ');

  return (
    <>
      <PageHeader
        title={`Welcome back, ${session.user?.name.split(' ')[0] ?? 'there'}`}
        description={`Your role can reach: ${reach}. Every figure below is computed from this deployment's own activity.`}
        action={
          <Link
            href="/chat"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
          >
            Ask a question
          </Link>
        }
      />

      {env().DEMO_MODE ? (
        <div className="mb-6">
          <InlineNote tone="iris">
            <strong className="text-ink">Demo mode is enabled.</strong> Embeddings and answer
            generation run on deterministic local providers, and the corpus describes a fictional
            company. Retrieval is term-overlap based rather than semantic — switch{' '}
            <code className="font-mono text-accent-soft">EMBEDDING_PROVIDER</code> and{' '}
            <code className="font-mono text-accent-soft">LLM_PROVIDER</code> to a live service and
            reprocess to get semantic quality.
          </InlineNote>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Indexed documents"
          value={formatNumber(metrics.documents.indexed)}
          hint={`${formatNumber(metrics.documents.chunks)} retrievable passages`}
        />
        <StatTile
          label="Questions answered"
          value={formatNumber(metrics.conversations.questions)}
          hint={`across ${formatNumber(metrics.conversations.total)} conversations`}
          sparkline={activity.map((point) => point.questions)}
        />
        <StatTile
          label="Grounded answers"
          value={formatPercent(metrics.quality.groundedRate)}
          hint={`mean confidence ${formatPercent(metrics.quality.averageConfidence)}`}
          tone={metrics.quality.groundedRate >= 0.6 ? 'good' : 'warning'}
        />
        <StatTile
          label="Open escalations"
          value={formatNumber(metrics.escalations.open)}
          hint={`${formatNumber(metrics.escalations.resolved)} resolved`}
          tone={metrics.escalations.open > 0 ? 'warning' : 'good'}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Question volume"
            description="Questions asked per day over the last 14 days"
          />
          <ActivityChart points={activity} />
        </Panel>

        <Panel>
          <PanelHeader
            title="Answer grounding"
            description="How well retrieved sources supported each answer"
          />
          <SegmentedBar
            segments={[
              {
                label: 'Supported',
                value: Math.round(metrics.quality.groundedRate * metrics.conversations.questions),
                tone: 'good',
              },
              {
                label: 'Partially supported',
                value: Math.round(
                  metrics.quality.partiallyGroundedRate * metrics.conversations.questions,
                ),
                tone: 'warning',
              },
              {
                label: 'Not supported',
                value: Math.round(
                  metrics.quality.unsupportedRate * metrics.conversations.questions,
                ),
                tone: 'critical',
              },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Ingestion state" description="Where every source currently sits" />
          <div className="grid grid-cols-2 gap-px bg-edge-subtle sm:grid-cols-4">
            {[
              { label: 'Indexed', value: metrics.documents.indexed, tone: 'good' as const },
              { label: 'Processing', value: metrics.documents.processing, tone: 'accent' as const },
              { label: 'Failed', value: metrics.documents.failed, tone: 'critical' as const },
              { label: 'Archived', value: metrics.documents.archived, tone: 'neutral' as const },
            ].map((item) => (
              <div key={item.label} className="bg-canvas-raised px-4 py-4">
                <p className="text-xl font-semibold tabular-nums text-ink">
                  {formatNumber(item.value)}
                </p>
                <p className="mt-1 text-xs text-ink-muted">{item.label}</p>
              </div>
            ))}
          </div>
          {metrics.documents.failed > 0 && hasPermission(session.role, 'document:reprocess') ? (
            <div className="border-t border-edge px-5 py-3">
              <Link
                href="/dashboard/documents?status=FAILED"
                className="text-sm text-accent hover:text-accent-soft"
              >
                Review {metrics.documents.failed} failed document
                {metrics.documents.failed === 1 ? '' : 's'} →
              </Link>
            </div>
          ) : null}
        </Panel>

        {canSeeAnalytics ? (
          <Panel>
            <PanelHeader
              title="Most-cited sources"
              description="Which documents are actually answering questions"
              action={
                <Link
                  href="/dashboard/analytics"
                  className="text-xs text-accent hover:text-accent-soft"
                >
                  All analytics →
                </Link>
              }
            />
            <BarList
              valueLabel="citations"
              emptyMessage="No answers have cited a source yet."
              items={topDocuments.map((document) => ({
                label: document.title,
                value: document.citationCount,
                secondary: ACCESS_LEVEL_LABELS[document.accessLevel],
              }))}
            />
          </Panel>
        ) : (
          <Panel>
            <PanelHeader title="Your access" description="What this role can reach" />
            <div className="space-y-3 px-5 py-4">
              {allowedAccessLevels(session.role).map((level) => (
                <div key={level} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-muted">{ACCESS_LEVEL_LABELS[level]}</span>
                  <Badge tone="good">Readable</Badge>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
