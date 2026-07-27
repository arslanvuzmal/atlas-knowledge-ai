import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { FeedbackReviewToggle } from '@/components/dashboard/controls';
import { RatingBadge } from '@/components/dashboard/status-badges';
import { Cell, DataTable, EmptyState, PageHeader, Panel } from '@/components/ui/primitives';
import { SegmentedBar } from '@/components/dashboard/charts';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Feedback' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'NEGATIVE', label: 'Negative only' },
  { value: 'UNREVIEWED', label: 'Not reviewed' },
];

const REASON_LABELS: Record<string, string> = {
  INCORRECT_ANSWER: 'Incorrect answer',
  MISSING_INFORMATION: 'Missing information',
  WRONG_SOURCE: 'Wrong source',
  OUTDATED_INFORMATION: 'Outdated information',
  TOO_VAGUE: 'Too vague',
  ACCESS_ISSUE: 'Access issue',
  OTHER: 'Other',
};

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await getSession();
  if (!hasPermission(session.role, 'feedback:review')) {
    return <AccessDenied area="feedback review" />;
  }

  const params = await searchParams;
  const filter = (params.filter ?? 'ALL').toUpperCase();

  const where =
    filter === 'NEGATIVE'
      ? { rating: 'NOT_HELPFUL' as const }
      : filter === 'UNREVIEWED'
        ? { reviewed: false }
        : {};

  const [items, groups] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: {
        user: { select: { name: true } },
        message: {
          select: {
            content: true,
            grounded: true,
            confidence: true,
            conversationId: true,
          },
        },
      },
    }),
    prisma.feedback.groupBy({ by: ['rating'], _count: { _all: true } }),
  ]);

  const countFor = (rating: string) =>
    groups.find((entry) => entry.rating === rating)?._count._all ?? 0;

  return (
    <>
      <PageHeader
        title="Feedback"
        description="What users said about the answers they received. Negative feedback automatically raises an escalation."
      />

      <Panel className="mb-6">
        <SegmentedBar
          segments={[
            { label: 'Helpful', value: countFor('HELPFUL'), tone: 'good' },
            { label: 'Partly helpful', value: countFor('PARTIALLY_HELPFUL'), tone: 'warning' },
            { label: 'Not helpful', value: countFor('NOT_HELPFUL'), tone: 'critical' },
          ]}
        />
      </Panel>

      <Panel>
        <div className="flex flex-wrap gap-1.5 border-b border-edge px-5 py-3">
          {FILTERS.map((option) => (
            <Link
              key={option.value}
              href={`/dashboard/feedback?filter=${option.value}`}
              aria-current={filter === option.value ? 'page' : undefined}
              className={
                filter === option.value
                  ? 'rounded-md bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent-soft'
                  : 'rounded-md px-2.5 py-1 text-xs text-ink-muted transition hover:bg-canvas-overlay hover:text-ink'
              }
            >
              {option.label}
            </Link>
          ))}
        </div>

        {items.length === 0 ? (
          <EmptyState
            title="No feedback here"
            description="Nothing matches this filter. Feedback appears as users rate the answers they receive."
          />
        ) : (
          <DataTable
            caption="Answer feedback"
            headers={['Rating', 'Reason', 'Answer', 'From', 'When', { label: '', align: 'right' }]}
          >
            {items.map((item) => (
              <tr key={item.id}>
                <Cell>
                  <RatingBadge rating={item.rating} />
                </Cell>
                <Cell>
                  {item.reason ? (
                    <span className="text-xs">{REASON_LABELS[item.reason] ?? item.reason}</span>
                  ) : (
                    <span className="text-xs text-ink-faint">—</span>
                  )}
                </Cell>
                <Cell className="max-w-md">
                  <Link
                    href={`/dashboard/conversations/${item.message.conversationId}`}
                    className="line-clamp-2 text-[13px] text-ink-muted hover:text-accent"
                  >
                    {item.message.content.slice(0, 180)}
                  </Link>
                  {item.comment ? (
                    <p className="mt-1 text-[11px] italic text-ink-faint">“{item.comment}”</p>
                  ) : null}
                </Cell>
                <Cell>
                  <span className="text-xs">{item.user?.name ?? 'Anonymous'}</span>
                </Cell>
                <Cell>
                  <span className="text-xs text-ink-faint">{formatRelative(item.createdAt)}</span>
                </Cell>
                <Cell align="right">
                  <FeedbackReviewToggle feedbackId={item.id} reviewed={item.reviewed} />
                </Cell>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
