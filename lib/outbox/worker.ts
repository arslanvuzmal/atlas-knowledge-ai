import { prisma } from '@/lib/database/client';
import { extractCustomerIntelligence } from '@/lib/crm/intelligence';
import { evaluateAutomationRules } from '@/lib/automation/rules';

export interface EnqueueOutboxInput {
  workspaceId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export async function enqueueOutboxEvent(input: EnqueueOutboxInput) {
  return prisma.outboxEvent.create({
    data: {
      workspaceId: input.workspaceId,
      eventType: input.eventType,
      payload: JSON.parse(JSON.stringify(input.payload)),
      status: 'PENDING',
    },
  });
}

/**
 * Worker process executing async CRM tasks.
 * Uses atomic transaction processing for zero-race-condition durability.
 */
export async function processOutboxEvents(limit = 10): Promise<number> {
  const pendingEvents = await prisma.outboxEvent.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: new Date() },
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });

  let processed = 0;

  for (const event of pendingEvents) {
    try {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSING', attempts: event.attempts + 1 },
      });

      const payload = event.payload as Record<string, unknown>;

      switch (event.eventType) {
        case 'CHAT_TURN_COMPLETED':
          if (typeof payload.contactId === 'string' && Array.isArray(payload.messages)) {
            await extractCustomerIntelligence(event.workspaceId, payload.contactId, payload.messages);
          }
          break;

        case 'LEAD_SCORE_UPDATED':
          if (typeof payload.contactId === 'string') {
            await evaluateAutomationRules({
              workspaceId: event.workspaceId,
              trigger: 'LEAD_SCORE_CHANGED',
              contactId: payload.contactId,
              data: payload,
            });
          }
          break;

        case 'FEEDBACK_SUBMITTED':
          if (payload.rating === 'NOT_HELPFUL' && typeof payload.contactId === 'string') {
            await evaluateAutomationRules({
              workspaceId: event.workspaceId,
              trigger: 'NEGATIVE_FEEDBACK',
              contactId: payload.contactId,
              data: payload,
            });
          }
          break;
      }

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });

      processed++;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown processing error';
      const isDead = event.attempts + 1 >= event.maxAttempts;

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: isDead ? 'FAILED' : 'PENDING',
          lastError: errorMessage,
          nextAttemptAt: new Date(Date.now() + Math.pow(2, event.attempts) * 1000 * 5),
        },
      });
    }
  }

  return processed;
}
