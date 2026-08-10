import { prisma } from '@/lib/database/client';
import type { DealStatus } from '@prisma/client';

export interface CreateDealInput {
  workspaceId: string;
  name: string;
  pipelineId?: string;
  stageId?: string;
  primaryCompanyId?: string;
  primaryContactId?: string;
  ownerId?: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date;
  source?: string;
  sourceConversationId?: string;
}

export async function createDeal(input: CreateDealInput) {
  let pipelineId = input.pipelineId;
  let stageId = input.stageId;

  if (!pipelineId) {
    const defaultPipeline = await prisma.pipeline.findFirst({
      where: { workspaceId: input.workspaceId, isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (defaultPipeline) {
      pipelineId = defaultPipeline.id;
      stageId = stageId ?? defaultPipeline.stages[0]?.id;
    }
  }

  if (!pipelineId || !stageId) {
    throw new Error('Pipeline and Stage must exist to create a Deal.');
  }

  const deal = await prisma.deal.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      pipelineId,
      stageId,
      primaryCompanyId: input.primaryCompanyId,
      primaryContactId: input.primaryContactId,
      ownerId: input.ownerId,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      expectedCloseDate: input.expectedCloseDate,
      source: input.source ?? 'Manual Creation',
      sourceConversationId: input.sourceConversationId,
      status: 'OPEN',
    },
  });

  await prisma.crmActivity.create({
    data: {
      workspaceId: input.workspaceId,
      contactId: input.primaryContactId,
      companyId: input.primaryCompanyId,
      dealId: deal.id,
      type: 'DEAL_CREATED',
      title: 'Deal Created',
      description: `Created deal "${deal.name}" (${deal.amount ? `$${deal.amount}` : 'Amount TBD'})`,
    },
  });

  return deal;
}

export async function listDeals(
  workspaceId: string,
  options?: { status?: DealStatus; stageId?: string; limit?: number; offset?: number },
) {
  const { status, stageId, limit = 50, offset = 0 } = options ?? {};
  const where: Record<string, unknown> = { workspaceId };
  if (status) where.status = status;
  if (stageId) where.stageId = stageId;

  const [items, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { updatedAt: 'desc' },
      include: {
        stage: { select: { id: true, name: true, winProbability: true } },
        primaryCompany: { select: { id: true, name: true } },
        primaryContact: { select: { id: true, displayName: true, primaryEmail: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.deal.count({ where }),
  ]);

  return { items, total };
}

export async function updateDealStage(workspaceId: string, dealId: string, stageId: string) {
  const deal = await prisma.deal.findFirst({ where: { workspaceId, id: dealId } });
  if (!deal) throw new Error('Deal not found');

  const newStage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  if (!newStage) throw new Error('Stage not found');

  let newStatus: DealStatus = 'OPEN';
  if (newStage.name === 'Won') newStatus = 'WON';
  else if (newStage.name === 'Lost') newStatus = 'LOST';

  const updated = await prisma.deal.update({
    where: { id: dealId },
    data: {
      stageId,
      status: newStatus,
      closedAt: newStatus !== 'OPEN' ? new Date() : null,
    },
  });

  await prisma.crmActivity.create({
    data: {
      workspaceId,
      dealId: deal.id,
      contactId: deal.primaryContactId,
      companyId: deal.primaryCompanyId,
      type: 'DEAL_STAGE_CHANGED',
      title: 'Deal Stage Updated',
      description: `Moved deal "${deal.name}" to ${newStage.name}`,
    },
  });

  return updated;
}
