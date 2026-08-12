import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enqueueOutboxEvent, processOutboxEvents } from '@/lib/outbox/worker';
import { prisma } from '@/lib/database/client';

describe('Durable Outbox Worker', () => {
  let workspaceId: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    let ws = await prisma.workspace.findFirst({ select: { id: true } });
    if (!ws) {
      ws = await prisma.workspace.create({
        data: { name: 'Test Outbox Workspace', slug: `test-outbox-${Date.now()}` },
        select: { id: true },
      });
    }
    workspaceId = ws.id;
  });

  it('enqueues outbox events with PENDING status', async () => {
    const event = await enqueueOutboxEvent({
      workspaceId,
      eventType: 'TEST_EVENT',
      payload: { foo: 'bar' },
    });

    expect(event.status).toBe('PENDING');
    expect(event.workspaceId).toBe(workspaceId);
    expect(event.eventType).toBe('TEST_EVENT');

    // Clean up
    await prisma.outboxEvent.delete({ where: { id: event.id } }).catch(() => {});
  });

  it('recovers stale processing events (> 5 mins) back to PENDING', async () => {
    const staleEvent = await prisma.outboxEvent.create({
      data: {
        workspaceId,
        eventType: 'STALE_EVENT',
        payload: { test: true },
        status: 'PROCESSING',
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 mins ago
      },
    });

    await processOutboxEvents(10);

    const refreshed = await prisma.outboxEvent.findUnique({
      where: { id: staleEvent.id },
    });

    expect(refreshed?.status).toBe('PROCESSED');

    // Clean up
    await prisma.outboxEvent.delete({ where: { id: staleEvent.id } }).catch(() => {});
  });
});
