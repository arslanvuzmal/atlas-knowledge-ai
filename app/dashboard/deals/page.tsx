import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { prisma } from '@/lib/database/client';
import { PageHeader } from '@/components/ui/primitives';
import { DealsView } from '@/components/dashboard/deals-view';
import { notFound } from 'next/navigation';

export default async function DealsPage() {
  const workspace = await getCurrentWorkspaceContext();
  if (!workspace) notFound();

  const [pipeline, deals] = await Promise.all([
    prisma.pipeline.findFirst({
      where: { workspaceId: workspace.id, isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    }),
    prisma.deal.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        stage: { select: { name: true } },
        primaryCompany: { select: { name: true } },
        primaryContact: { select: { displayName: true } },
        owner: { select: { name: true } },
      },
    }),
  ]);

  const stages =
    pipeline?.stages.map((st) => ({
      id: st.id,
      name: st.name,
      order: st.order,
    })) ?? [];

  const formattedDeals = deals.map((d) => ({
    id: d.id,
    name: d.name,
    amount: d.amount,
    currency: d.currency,
    status: d.status,
    stageId: d.stageId,
    stageName: d.stage.name,
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
}
