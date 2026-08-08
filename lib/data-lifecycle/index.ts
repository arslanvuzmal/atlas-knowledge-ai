import { prisma } from '@/lib/database/client';
import { logger } from '@/lib/observability/logger';
import { env } from '@/lib/env';

/**
 * Data Lifecycle Management
 *
 * Handles retention policies, user data export, and erasure (right to be forgotten).
 */

export interface RetentionPolicy {
  conversationsDays: number;
  retrievalLogsDays: number;
  auditLogsDays: number;
  feedbackDays: number;
  escalationsDays: number;
  messagesDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  conversationsDays: 365,
  retrievalLogsDays: 90,
  auditLogsDays: 365,
  feedbackDays: 365,
  escalationsDays: 365,
  messagesDays: 365,
};

/**
 * Gets the effective retention policy from environment or defaults.
 */
export function getRetentionPolicy(): RetentionPolicy {
  return {
    conversationsDays: env().RETENTION_CONVERSATIONS_DAYS ?? DEFAULT_RETENTION.conversationsDays,
    retrievalLogsDays: env().RETENTION_RETRIEVAL_LOGS_DAYS ?? DEFAULT_RETENTION.retrievalLogsDays,
    auditLogsDays: env().RETENTION_AUDIT_LOGS_DAYS ?? DEFAULT_RETENTION.auditLogsDays,
    feedbackDays: env().RETENTION_FEEDBACK_DAYS ?? DEFAULT_RETENTION.feedbackDays,
    escalationsDays: env().RETENTION_ESCALATIONS_DAYS ?? DEFAULT_RETENTION.escalationsDays,
    messagesDays: env().RETENTION_MESSAGES_DAYS ?? DEFAULT_RETENTION.messagesDays,
  };
}

/**
 * Applies retention policies by deleting old records.
 * Returns counts of deleted records.
 */
export async function applyRetentionPolicies(): Promise<{
  conversations: number;
  retrievalLogs: number;
  auditLogs: number;
  feedback: number;
  escalations: number;
  messages: number;
}> {
  const policy = getRetentionPolicy();
  const now = new Date();

  const conversationCutoff = new Date(
    now.getTime() - policy.conversationsDays * 24 * 60 * 60 * 1000,
  );
  const retrievalCutoff = new Date(now.getTime() - policy.retrievalLogsDays * 24 * 60 * 60 * 1000);
  const auditCutoff = new Date(now.getTime() - policy.auditLogsDays * 24 * 60 * 60 * 1000);
  const feedbackCutoff = new Date(now.getTime() - policy.feedbackDays * 24 * 60 * 60 * 1000);
  const escalationCutoff = new Date(now.getTime() - policy.escalationsDays * 24 * 60 * 60 * 1000);
  const messageCutoff = new Date(now.getTime() - policy.messagesDays * 24 * 60 * 60 * 1000);

  const [conversations, retrievalLogs, auditLogs, feedback, escalations, messages] =
    await Promise.all([
      prisma.conversation.deleteMany({
        where: { createdAt: { lt: conversationCutoff } },
      }),
      prisma.retrievalLog.deleteMany({
        where: { createdAt: { lt: retrievalCutoff } },
      }),
      prisma.auditLog.deleteMany({
        where: { createdAt: { lt: auditCutoff } },
      }),
      prisma.feedback.deleteMany({
        where: { createdAt: { lt: feedbackCutoff } },
      }),
      prisma.escalation.deleteMany({
        where: { createdAt: { lt: escalationCutoff } },
      }),
      prisma.message.deleteMany({
        where: { createdAt: { lt: messageCutoff } },
      }),
    ]);

  logger.info('Retention policies applied', {
    conversations: conversations.count,
    retrievalLogs: retrievalLogs.count,
    auditLogs: auditLogs.count,
    feedback: feedback.count,
    escalations: escalations.count,
    messages: messages.count,
  });

  return {
    conversations: conversations.count,
    retrievalLogs: retrievalLogs.count,
    auditLogs: auditLogs.count,
    feedback: feedback.count,
    escalations: escalations.count,
    messages: messages.count,
  };
}

/**
 * Exports all data associated with a user (GDPR Article 20 - Right to Data Portability).
 */
export async function exportUserData(userId: string): Promise<{
  user: any;
  conversations: any[];
  messages: any[];
  feedback: any[];
  escalations: any[];
  retrievalLogs: any[];
  auditLogs: any[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  const [conversations, messages, feedback, escalations, retrievalLogs, auditLogs] =
    await Promise.all([
      prisma.conversation.findMany({
        where: { userId },
        include: { messages: true },
      }),
      prisma.message.findMany({
        where: { conversation: { userId } },
        include: { citations: true, feedback: true },
      }),
      prisma.feedback.findMany({
        where: { userId },
      }),
      prisma.escalation.findMany({
        where: { userId },
        include: { conversation: true },
      }),
      prisma.retrievalLog.findMany({
        where: { conversation: { userId } },
      }),
      prisma.auditLog.findMany({
        where: { userId },
      }),
    ]);

  logger.info('User data exported', { userId, conversationCount: conversations.length });

  return {
    user,
    conversations,
    messages,
    feedback,
    escalations,
    retrievalLogs,
    auditLogs,
  };
}

/**
 * Erases all data associated with a user (GDPR Article 17 - Right to Erasure).
 * Some data (audit logs) may be retained for legal compliance.
 */
export async function eraseUserData(
  userId: string,
  options: { retainAuditLogs?: boolean } = {},
): Promise<{
  erased: {
    conversations: number;
    messages: number;
    feedback: number;
    escalations: number;
    retrievalLogs: number;
  };
  retained: {
    auditLogs: number;
  };
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Delete user's data in the correct order (respecting foreign keys)
  const [conversations, messages, feedback, escalations, retrievalLogs] = await Promise.all([
    prisma.conversation.deleteMany({ where: { userId } }),
    prisma.message.deleteMany({ where: { conversation: { userId } } }),
    prisma.feedback.deleteMany({ where: { userId } }),
    prisma.escalation.deleteMany({ where: { userId } }),
    prisma.retrievalLog.deleteMany({ where: { conversation: { userId } } }),
  ]);

  let retainedAuditLogs = 0;
  if (!options.retainAuditLogs) {
    const auditResult = await prisma.auditLog.deleteMany({ where: { userId } });
    retainedAuditLogs = auditResult.count;
  } else {
    // Anonymize audit logs instead of deleting - set sensitive fields to empty objects
    const auditResult = await prisma.auditLog.updateMany({
      where: { userId },
      data: { userId: null, ipHash: null, previousData: {}, newData: {}, metadata: {} },
    });
    retainedAuditLogs = auditResult.count;
  }

  // Finally delete the user
  await prisma.user.delete({ where: { id: userId } });

  logger.info('User data erased', {
    userId,
    conversations: conversations.count,
    messages: messages.count,
    feedback: feedback.count,
    escalations: escalations.count,
    retrievalLogs: retrievalLogs.count,
    retained: { auditLogs: retainedAuditLogs },
  });

  return {
    erased: {
      conversations: conversations.count,
      messages: messages.count,
      feedback: feedback.count,
      escalations: escalations.count,
      retrievalLogs: retrievalLogs.count,
    },
    retained: {
      auditLogs: retainedAuditLogs,
    },
  };
}

/**
 * Schedules periodic retention cleanup.
 * In production, this should be run as a cron job or scheduled task.
 */
export function scheduleRetentionCleanup(intervalHours = 24): NodeJS.Timeout {
  return setInterval(
    async () => {
      try {
        await applyRetentionPolicies();
      } catch (error) {
        logger.error('Retention cleanup failed', { error });
      }
    },
    intervalHours * 60 * 60 * 1000,
  );
}
