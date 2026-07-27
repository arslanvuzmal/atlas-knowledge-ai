import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { env } from '@/lib/env';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Clears demo conversation activity.
 *
 * Deliberately narrow: it removes conversations, feedback, escalations, and
 * retrieval logs, and leaves documents, users, and settings intact. Rebuilding
 * the corpus is the seed script's job, and an HTTP endpoint that can wipe a
 * knowledge base is a liability even behind an admin check.
 *
 * Refuses outright when demo mode is off.
 */
export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'demo:reset',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  if (!env().DEMO_MODE) {
    return NextResponse.json(
      { error: 'Demo reset is only available while DEMO_MODE is enabled.' },
      { status: 403 },
    );
  }

  try {
    const [conversations, feedback, escalations, logs] = await Promise.all([
      prisma.conversation.count(),
      prisma.feedback.count(),
      prisma.escalation.count(),
      prisma.retrievalLog.count(),
    ]);

    // Messages, citations, feedback, and escalations cascade from Conversation.
    await prisma.$transaction([
      prisma.retrievalLog.deleteMany({}),
      prisma.conversation.deleteMany({}),
    ]);

    await recordAudit({
      action: 'demo.reset',
      entityType: 'System',
      userId: guard.session.user?.id ?? null,
      previousData: { conversations, feedback, escalations, retrievalLogs: logs },
      metadata: { scope: 'conversations, feedback, escalations, retrieval logs' },
      ip: guard.ip,
    });

    return NextResponse.json({
      ok: true,
      cleared: { conversations, feedback, escalations, retrievalLogs: logs },
      note: 'Documents, users, and settings were left untouched. Run `npm run db:seed` to rebuild sample conversations.',
    });
  } catch (error) {
    logger.error('Demo reset failed', { correlationId: guard.correlationId, error });
    return NextResponse.json({ error: 'The demo reset failed.' }, { status: 500 });
  }
}
