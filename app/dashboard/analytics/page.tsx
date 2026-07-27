import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { ActivityChart, BarList, SegmentedBar, StatTile } from '@/components/dashboard/charts';
import { InlineNote, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { ACCESS_LEVEL_LABELS, hasPermission } from '@/lib/auth/rbac';
import {
  getDailyActivity,
  getLowConfidenceTopics,
  getMostAskedQuestions,
  getMostUsedDocuments,
  getOverviewMetrics,
} from '@/lib/analytics/metrics';
import { formatNumber, formatPercent } from '@/lib/ui';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'analytics:view')) {
    return <AccessDenied area="analytics" />;
  }

  const [metrics, activity, topDocuments, topQuestions, gaps] = await Promise.all([
    getOverviewMetrics(),
    getDailyActivity(14),
    getMostUsedDocuments(8),
    getMostAskedQuestions(8),
    getLowConfidenceTopics(8),
  ]);

  const answered = metrics.conversations.questions;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Every figure is computed from this deployment's recorded activity. Nothing here is illustrative."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Questions asked"
          value={formatNumber(answered)}
          hint={`${formatNumber(metrics.conversations.total)} conversations`}
          sparkline={activity.map((point) => point.questions)}
        />
        <StatTile
          label="Mean confidence"
          value={formatPercent(metrics.quality.averageConfidence)}
          hint="Across all answered questions"
          tone={metrics.quality.averageConfidence >= 0.65 ? 'good' : 'warning'}
        />
        <StatTile
          label="Answers with citations"
          value={formatNumber(metrics.quality.answeredWithCitations)}
          hint={`of ${formatNumber(answered)} answers`}
        />
        <StatTile
          label="Median retrieval latency"
          value={`${formatNumber(metrics.performance.averageRetrievalLatencyMs)} ms`}
          hint={`p95 ${formatNumber(metrics.performance.p95RetrievalLatencyMs)} ms`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Question volume" description="Last 14 days" />
          <ActivityChart points={activity} />
        </Panel>

        <Panel>
          <PanelHeader
            title="Answer grounding"
            description="Proportion of answers by support level"
          />
          <SegmentedBar
            segments={[
              {
                label: 'Supported',
                value: Math.round(metrics.quality.groundedRate * answered),
                tone: 'good',
              },
              {
                label: 'Partially supported',
                value: Math.round(metrics.quality.partiallyGroundedRate * answered),
                tone: 'warning',
              },
              {
                label: 'Not supported',
                value: Math.round(metrics.quality.unsupportedRate * answered),
                tone: 'critical',
              },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="User feedback" description="Ratings submitted on answers" />
          <SegmentedBar
            segments={[
              { label: 'Helpful', value: metrics.feedback.positive, tone: 'good' },
              { label: 'Partly helpful', value: metrics.feedback.partial, tone: 'warning' },
              { label: 'Not helpful', value: metrics.feedback.negative, tone: 'critical' },
            ]}
          />
          {metrics.feedback.unreviewed > 0 ? (
            <div className="border-t border-edge px-5 py-3 text-xs text-ink-muted">
              {formatNumber(metrics.feedback.unreviewed)} item
              {metrics.feedback.unreviewed === 1 ? '' : 's'} not yet reviewed.
            </div>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader
            title="Most-cited sources"
            description="Which documents are actually answering questions"
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
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Most-asked questions" description="Grouped by normalised wording" />
          <BarList
            valueLabel="times asked"
            emptyMessage="No questions recorded yet."
            items={topQuestions.map((entry) => ({
              label: entry.question,
              value: entry.occurrences,
              secondary: formatPercent(entry.averageConfidence),
            }))}
          />
        </Panel>

        <Panel>
          <PanelHeader
            title="Content gaps"
            description="Questions that retrieved poorly. These are the documents worth writing next."
          />
          <BarList
            valueLabel="times asked"
            emptyMessage="No low-confidence questions recorded. Every question found supporting material."
            items={gaps.map((entry) => ({
              label: entry.question,
              value: entry.occurrences,
              secondary: formatPercent(entry.averageConfidence),
            }))}
          />
        </Panel>
      </div>

      <div className="mt-6">
        <InlineNote>
          Confidence is measured from the retrieved evidence — how much of the question the found
          passages cover — not from the wording of the answer. A fluent answer cannot raise it.
          These figures describe retrieval performance against this corpus and are not a general
          accuracy claim.
        </InlineNote>
      </div>
    </>
  );
}
