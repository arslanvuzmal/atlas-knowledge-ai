import { getOrCreateDefaultWorkspace } from '@/lib/workspace/context';
import { prisma } from '@/lib/database/client';
import { InboxWorkspace } from '@/components/dashboard/inbox-workspace';

export default async function InboxPage() {
  const workspace = await getOrCreateDefaultWorkspace();

  const conversations = await prisma.conversation.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { updatedAt: 'desc' },
    take: 30,
    include: {
      contact: {
        include: {
          company: { select: { name: true, domain: true } },
          intelligence: true,
          deals: { select: { id: true, name: true, amount: true, stage: { select: { name: true } } } },
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { citations: true },
      },
      tasks: { select: { id: true, title: true, dueAt: true, status: true } },
    },
  });

  const formatted = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
    status: c.status,
    contact: c.contact
      ? {
          id: c.contact.id,
          displayName: c.contact.displayName,
          primaryEmail: c.contact.primaryEmail,
          leadScore: c.contact.leadScore,
          leadTier: c.contact.leadTier,
          scoreFactors: Array.isArray(c.contact.scoreFactors) ? (c.contact.scoreFactors as unknown as { factor: string; points: number }[]) : undefined,
          company: c.contact.company,
          intelligence: c.contact.intelligence
            ? {
                summary: c.contact.intelligence.summary,
                primaryIntent: c.contact.intelligence.primaryIntent,
                productInterest: c.contact.intelligence.productInterest,
                urgency: c.contact.intelligence.urgency,
                seatRequirement: c.contact.intelligence.seatRequirement,
                timeline: c.contact.intelligence.timeline,
                requestedFollowUp: c.contact.intelligence.requestedFollowUp,
                explicitRequirements: c.contact.intelligence.explicitRequirements,
              }
            : null,
        }
      : null,
    messages: c.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      citations: m.citations.map((cit) => ({ documentId: cit.documentId, excerpt: cit.excerpt })),
    })),
    tasks: c.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      status: t.status,
    })),
    deals: (c.contact?.deals ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      amount: d.amount,
      stageName: d.stage.name,
    })),
  }));

  return <InboxWorkspace conversations={formatted} />;
}
