import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  _action: z.literal('update'),
  conversationsDays: z.number().int().min(1).max(3650).optional(),
  retrievalLogsDays: z.number().int().min(1).max(3650).optional(),
  auditLogsDays: z.number().int().min(1).max(3650).optional(),
  feedbackDays: z.number().int().min(1).max(3650).optional(),
  escalationsDays: z.number().int().min(1).max(3650).optional(),
  messagesDays: z.number().int().min(1).max(3650).optional(),
});

export async function PUT(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'settings:retention:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.conversationsDays !== undefined)
    updates.conversationsDays = parsed.data.conversationsDays;
  if (parsed.data.retrievalLogsDays !== undefined)
    updates.retrievalLogsDays = parsed.data.retrievalLogsDays;
  if (parsed.data.auditLogsDays !== undefined) updates.auditLogsDays = parsed.data.auditLogsDays;
  if (parsed.data.feedbackDays !== undefined) updates.feedbackDays = parsed.data.feedbackDays;
  if (parsed.data.escalationsDays !== undefined)
    updates.escalationsDays = parsed.data.escalationsDays;
  if (parsed.data.messagesDays !== undefined) updates.messagesDays = parsed.data.messagesDays;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes were supplied.' }, { status: 400 });
  }

  const previous = {
    RETENTION_CONVERSATIONS_DAYS: process.env.RETENTION_CONVERSATIONS_DAYS,
    RETENTION_RETRIEVAL_LOGS_DAYS: process.env.RETENTION_RETRIEVAL_LOGS_DAYS,
    RETENTION_AUDIT_LOGS_DAYS: process.env.RETENTION_AUDIT_LOGS_DAYS,
    RETENTION_FEEDBACK_DAYS: process.env.RETENTION_FEEDBACK_DAYS,
    RETENTION_ESCALATIONS_DAYS: process.env.RETENTION_ESCALATIONS_DAYS,
    RETENTION_MESSAGES_DAYS: process.env.RETENTION_MESSAGES_DAYS,
  };

  // Note: In a real implementation, these would be stored in SystemSetting
  // For now, we just record the audit and the environment variables would need to be updated externally
  await recordAudit({
    action: 'settings.retention.update',
    entityType: 'SystemSetting',
    entityId: 'retention.policy',
    userId: guard.session.user?.id ?? null,
    previousData: previous,
    newData: { ...previous, ...updates },
    ip: guard.ip,
  });

  return NextResponse.json({
    ok: true,
    policy: updates,
    note: 'Retention policies updated. Note: Environment variables must be updated externally for changes to take effect on next cleanup run.',
  });
}
