import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { prisma } from '@/lib/database/client';
import { PageHeader, Panel, PanelHeader, Badge, DefinitionList } from '@/components/ui/primitives';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getCurrentWorkspaceContext();
  if (!workspace) notFound();

  const contact = await prisma.contact.findFirst({
    where: { workspaceId: workspace.id, id },
    include: {
      company: true,
      intelligence: true,
      activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      conversations: { orderBy: { updatedAt: 'desc' }, include: { messages: { take: 1 } } },
      deals: { include: { stage: true } },
      tasks: true,
      tickets: true,
    },
  });

  if (!contact) {
    notFound();
  }

  const intel = contact.intelligence;
  const targetConvId = contact.conversations[0]?.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title={contact.displayName}
        description={contact.primaryEmail || 'No email provided'}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={
                targetConvId ? `/dashboard/inbox?conversation=${targetConvId}` : '/dashboard/inbox'
              }
              className="px-3 py-1.5 text-xs font-semibold rounded border border-edge bg-canvas hover:bg-canvas-overlay"
            >
              Open in Inbox
            </Link>
          </div>
        }
      />

      {/* Top Banner Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Lead Score</div>
          <div className="text-2xl font-bold text-ink mt-1 flex items-center justify-between">
            {contact.leadScore} / 100
            <Badge tone={contact.leadScore >= 70 ? 'good' : 'neutral'}>{contact.leadTier}</Badge>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Lifecycle Stage</div>
          <div className="text-lg font-semibold text-ink mt-1">{contact.lifecycleStage}</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Primary Company</div>
          <div className="text-lg font-semibold text-accent mt-1">
            {contact.company?.name || 'Unassociated'}
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Primary Intent</div>
          <div className="text-lg font-semibold text-ink mt-1">
            {intel?.primaryIntent || 'General'}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Customer Intelligence & Overview (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {intel ? (
            <Panel className="p-5">
              <PanelHeader
                title="Customer Intelligence"
                description="Derived from governed customer interactions"
              />
              <div className="space-y-4 pt-4 text-xs">
                <div>
                  <span className="font-semibold text-ink">Executive Summary:</span>
                  <p className="mt-1 text-ink-muted leading-relaxed">{intel.summary}</p>
                </div>
                <DefinitionList
                  items={[
                    { term: 'Customer Need', value: intel.customerNeed || '—' },
                    { term: 'Product Interest', value: intel.productInterest || '—' },
                    {
                      term: 'Seat Requirement',
                      value: intel.seatRequirement ? `${intel.seatRequirement} seats` : '—',
                    },
                    { term: 'Timeline', value: intel.timeline || '—' },
                    { term: 'Urgency', value: intel.urgency || '—' },
                    { term: 'Sentiment', value: intel.sentiment || '—' },
                  ]}
                />
              </div>
            </Panel>
          ) : null}

          {/* Unified Activity Timeline */}
          <Panel className="p-5">
            <PanelHeader
              title="Unified Activity Timeline"
              description="Chronological record of every customer event"
            />
            <div className="space-y-4 pt-4">
              {contact.activities.map((act) => (
                <div key={act.id} className="flex gap-3 text-xs">
                  <div className="w-2 h-2 rounded-full bg-accent mt-1.5 shrink-0" />
                  <div>
                    <div className="font-semibold text-ink">{act.title}</div>
                    {act.description ? (
                      <div className="text-ink-muted mt-0.5">{act.description}</div>
                    ) : null}
                    <div className="text-[10px] text-ink-faint mt-1">
                      {new Date(act.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Right Column: Deals, Tasks, Tickets (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          <Panel className="p-4">
            <PanelHeader title="Deals" />
            <div className="space-y-2 pt-3">
              {contact.deals.map((d) => (
                <div
                  key={d.id}
                  className="p-3 rounded border border-edge bg-canvas-overlay text-xs flex justify-between"
                >
                  <div>
                    <div className="font-semibold text-ink">{d.name}</div>
                    <div className="text-ink-faint mt-0.5">Stage: {d.stage.name}</div>
                  </div>
                  <div className="font-bold text-accent">
                    {d.amount != null ? `$${d.amount.toLocaleString()}` : '—'}
                  </div>
                </div>
              ))}

              {contact.deals.length === 0 ? (
                <div className="text-xs text-ink-faint py-2">No open deals</div>
              ) : null}
            </div>
          </Panel>

          <Panel className="p-4">
            <PanelHeader title="Tasks" />
            <div className="space-y-2 pt-3">
              {contact.tasks.map((t) => (
                <div
                  key={t.id}
                  className="p-3 rounded border border-edge bg-canvas-overlay text-xs flex justify-between"
                >
                  <div>
                    <div className="font-semibold text-ink">{t.title}</div>
                    <div className="text-ink-faint mt-0.5">Status: {t.status}</div>
                  </div>
                  <Badge tone={t.priority === 'HIGH' ? 'warning' : 'neutral'}>{t.priority}</Badge>
                </div>
              ))}

              {contact.tasks.length === 0 ? (
                <div className="text-xs text-ink-faint py-2">No pending tasks</div>
              ) : null}
            </div>
          </Panel>

          <Panel className="p-4">
            <PanelHeader title="Tickets" />
            <div className="space-y-2 pt-3">
              {contact.tickets.map((tk) => (
                <div
                  key={tk.id}
                  className="p-3 rounded border border-edge bg-canvas-overlay text-xs flex justify-between"
                >
                  <div>
                    <div className="font-semibold text-ink">{tk.subject}</div>
                    <div className="text-ink-faint mt-0.5">Status: {tk.status}</div>
                  </div>
                  <Badge
                    tone={
                      tk.priority === 'HIGH' || tk.priority === 'URGENT' ? 'critical' : 'neutral'
                    }
                  >
                    {tk.priority}
                  </Badge>
                </div>
              ))}

              {contact.tickets.length === 0 ? (
                <div className="text-xs text-ink-faint py-2">No open support tickets</div>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
