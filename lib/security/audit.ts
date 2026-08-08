import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { keyedHash } from '@/lib/security/hash';
import { logger, redact } from '@/lib/observability/logger';

/**
 * Append-only audit trail.
 *
 * Writes are best-effort by design: an audit failure must never take down the
 * operation the user asked for, but it must be loud in the logs. IP addresses
 * are stored as keyed hashes so the trail supports correlation without
 * retaining a directly identifying value.
 */

export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.logout',
  'auth.lockout',
  'user.create',
  'user.update',
  'user.role.change',
  'user.status.change',
  'document.upload',
  'document.ingest.start',
  'document.ingest.complete',
  'document.ingest.failure',
  'document.reprocess',
  'document.archive',
  'document.delete',
  'document.access-level.change',
  'document.download',
  'document.url.ingest',
  'knowledgebase.create',
  'knowledgebase.update',
  'chat.query',
  'chat.access.denied',
  'chat.injection.detected',
  'feedback.create',
  'feedback.review',
  'escalation.create',
  'escalation.update',
  'settings.retrieval.update',
  'settings.models.update',
  'integration.update',
  'integration.test',
  'settings.retention.update',
  'settings.retention.run',
  'demo.reset',
  'security.rate-limit',
  'security.unauthorised',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  userId?: string | null;
  previousData?: unknown;
  newData?: unknown;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return redact(value) as Prisma.InputJsonValue;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        userId: input.userId ?? null,
        previousData: toJson(input.previousData),
        newData: toJson(input.newData),
        metadata: toJson(input.metadata),
        ipHash: input.ip ? keyedHash(input.ip, env().AUTH_SECRET) : null,
      },
    });
  } catch (error) {
    logger.error('Failed to write audit log entry', {
      action: input.action,
      entityType: input.entityType,
      error,
    });
  }
}
