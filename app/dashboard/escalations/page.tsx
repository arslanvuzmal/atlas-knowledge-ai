import type { Metadata } from 'next';
import Link from 'next/link';
import type { EscalationStatus } from '@prisma/client';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { EscalationControls } from '@/components/dashboard/controls';
import { EscalationStatusBadge, PriorityBadge } from '@/components/dashboard/status-badges';
import { EmptyState, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Escalations' };
export const dynamic = 'force-dynamic';

const FILTERS: { value: string; label: string }[] = [
  { value: 'ACTIVE', label: 'Needs attention' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'ALL', label: 'All' },
];

export default async function EscalationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getSession();
  if (!hasPermission(session.role, 'escalation:read')) {
    return <AccessDenied area="the escalation queue" />;
  }

  const params = await searchParams;
  const filter = (params.status ?? 'ACTIVE').toUpperCase();

  const statusWhere =
    filter === 'ALL'
      ? {}
      : filter === 'ACTIVE'
        ? { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] as EscalationStatus[] } }
        : { status: filter as EscalationStatus };

  const [escalations, assignees, counts] = await Promise.all([
    prisma.escalation.findMany({
      where: statusWhere,
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: 60,
      include: {
        user: { select: { name: true, email: true } },
        assignee: { select: { id: true, name: true } },
        conversation: { select: { id: true, title: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: ['MANAGER', 'ADMIN'] }, status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.escalation.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const countFor = (status: string) =>
    counts.find((entry) => entry.status === status)?._count._all ?? 0;

  const canManage = hasPermission(session.role, 'escalation:manage');

  return (
    <>
      <PageHeader
        title="Escalations"
        description="Questions the assistant could not answer confidently, plus every explicit request for a human."
      />

      <Panel>
        <div className="flex flex-wrap gap-1.5 border-b border-edge px-5 py-3">
          {FILTERS.map((option) => {
            const active = filter === option.value;
            const count =
              option.value === 'ALL'
                ? counts.reduce((sum, entry) => sum + entry._count._all, 0)
                : option.value === 'ACTIVE'
                  ? countFor('OPEN') + countFor('ASSIGNED') + countFor('IN_PROGRESS')
                  : countFor(option.value);
            return (
              <Link
                key={option.value}
                href={`/dashboard/escalations?status=${option.value}`}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'rounded-md bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent-soft'
                    : 'rounded-md px-2.5 py-1 text-xs text-ink-muted transition hover:bg-canvas-overlay hover:text-ink'
                }
              >
                {option.label}
                <span className="ml-1.5 tabular-nums text-ink-faint">{count}</span>
              </Link>
            );
          })}
        </div>

        {escalations.length === 0 ? (
          <EmptyState
            title="Nothing in this queue"
            description="No escalations match this filter. Escalations are raised automatically on low confidence, unsupported answers, negative feedback, and detected injection attempts."
          />
        ) : (
          <ul className="divide-y divide-edge-subtle">
            {escalations.map((escalation) => (
              <li key={escalation.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <EscalationStatusBadge status={escalation.status} />
                      <PriorityBadge priority={escalation.priority} />
                      <span className="text-xs text-ink-faint">
                        {formatRelative(escalation.createdAt)}
                      </span>
                    </div>

                    <p className="mt-2 text-sm font-medium text-ink">{escalation.reason}</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {escalation.user
                        ? `Raised by ${escalation.user.name}`
                        : 'Raised by an anonymous visitor'}
                      {escalation.assignee ? ` · assigned to ${escalation.assignee.name}` : ''}
                    </p>

                    <details className="mt-3 group">
                      <summary className="cursor-pointer text-xs text-accent hover:text-accent-soft">
                        Conversation summary and suggested reply
                      </summary>
                      <div className="mt-3 space-y-3 rounded-md border border-edge bg-canvas-sunken p-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                            Summary
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">
                            {escalation.summary}
                          </p>
                        </div>
                        {escalation.suggestedReply ? (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                              Suggested reply
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">
                              {escalation.suggestedReply}
                            </p>
                          </div>
                        ) : null}
                        {escalation.resolutionNote ? (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                              Resolution
                            </p>
                            <p className="mt-1 text-[13px] leading-relaxed text-status-good">
                              {escalation.resolutionNote}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </div>

                  {canManage ? (
                    <EscalationControls
                      escalationId={escalation.id}
                      status={escalation.status}
                      assignees={assignees}
                      assignedTo={escalation.assignedTo}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="When an escalation is raised" />
        <ul className="space-y-2 px-5 py-4 text-sm text-ink-muted">
          {[
            'Retrieval confidence falls below the configured threshold.',
            'No approved source supports an answer at all.',
            'A user marks an answer as not helpful.',
            'A user explicitly asks for a human.',
            'The question matches prompt-injection patterns, which raises a high-priority item.',
            'The generated answer referenced a source that was not retrieved.',
          ].map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              {reason}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
