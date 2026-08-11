import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { prisma } from '@/lib/database/client';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { DealsView } from '@/components/dashboard/deals-view';

export default async function DealsPage() {
  try {
    const workspace = await getCurrentWorkspaceContext();

    const [pipeline, deals] = await Promise.all([
      prisma.pipeline
        .findFirst({
          where: { workspaceId: workspace.id, isDefault: true },
          include: { stages: { orderBy: { order: 'asc' } } },
        })
        .catch(() => null),
      prisma.deal
        .findMany({
          where: { workspaceId: workspace.id },
          orderBy: { updatedAt: 'desc' },
          include: {
            stage: { select: { name: true } },
            primaryCompany: { select: { name: true } },
            primaryContact: { select: { displayName: true } },
            owner: { select: { name: true } },
          },
        })
        .catch(() => []),
    ]);

    const stages = pipeline?.stages.map((st) => ({
      id: st.id,
      name: st.name,
      order: st.order,
    })) ?? [
      { id: 'lead', name: 'Lead', order: 1 },
      { id: 'contacted', name: 'Contacted', order: 2 },
      { id: 'proposal', name: 'Proposal Sent', order: 3 },
      { id: 'won', name: 'Won', order: 4 },
    ];

    const formattedDeals = deals.map((d) => ({
      id: d.id,
      name: d.name,
      amount: d.amount,
      currency: d.currency,
      status: d.status,
      stageId: d.stageId,
      stageName: d.stage?.name || 'Lead',
      companyName: d.primaryCompany?.name,
      contactName: d.primaryContact?.displayName,
      ownerName: d.owner?.name,
    }));

    return (
      <div className="space-y-6">
        <PageHeader
          title="Deals Pipeline"
          description="Sales opportunities, deal stages, and revenue pipeline."
        />

        <DealsView deals={formattedDeals} stages={stages} />
      </div>
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="space-y-4">
        <PageHeader title="Deals Pipeline" description="Sales opportunities and pipeline" />
        <Panel className="p-6 border-status-bad/40 bg-status-bad/10">
          <h2 className="text-sm font-bold text-status-bad">Deals Pipeline Diagnostics Notice</h2>
          <p className="text-xs font-mono text-ink mt-2">{message}</p>
        </Panel>
      </div>
    );
  }
}
