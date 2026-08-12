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
  // Recover stale events stuck in PROCESSING for over 5 minutes
  await prisma.outboxEvent
    .updateMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      data: {
        status: 'PENDING',
      },
    })
    .catch(() => {});

  let eventsToProcess: Array<{
    id: string;
    workspaceId: string;
    eventType: string;
    payload: unknown;
    attempts: number;
    maxAttempts: number;
  }> = [];

  try {
    eventsToProcess = await prisma.$queryRaw`
      UPDATE "OutboxEvent"
      SET "status" = 'PROCESSING', "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id"
        FROM "OutboxEvent"
        WHERE "status" = 'PENDING' AND "nextAttemptAt" <= NOW()
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "workspaceId", "eventType", "payload", "attempts", "maxAttempts";
    `;
  } catch {
    // Fallback if raw UPDATE SKIP LOCKED is not supported
    const pendingEvents = await prisma.outboxEvent.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    eventsToProcess = [];
    for (const event of pendingEvents) {
      try {
        const updated = await prisma.outboxEvent.update({
          where: { id: event.id, status: 'PENDING' },
          data: { status: 'PROCESSING', attempts: event.attempts + 1 },
        });
        eventsToProcess.push(updated);
      } catch {
        // Another worker claimed it
      }
    }
  }

  let processed = 0;

  for (const event of eventsToProcess) {
    try {
      const payload = (event.payload ?? {}) as Record<string, unknown>;

      switch (event.eventType) {
        case 'CHAT_TURN_COMPLETED': {
          const conversationId =
            typeof payload.conversationId === 'string' ? payload.conversationId : null;
          const contactId = typeof payload.contactId === 'string' ? payload.contactId : null;

          if (conversationId && contactId) {
            const conversation = await prisma.conversation.findFirst({
              where: { id: conversationId, workspaceId: event.workspaceId },
              include: {
                messages: {
                  orderBy: { createdAt: 'asc' },
                  take: 20,
                  select: { role: true, content: true },
                },
              },
            });

            if (conversation && conversation.messages.length > 0) {
              await extractCustomerIntelligence(
                event.workspaceId,
                contactId,
                conversation.messages.map((m) => ({ role: m.role, content: m.content })),
              );
            }
          }
          break;
        }

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
      const isDead = event.attempts >= event.maxAttempts;

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
