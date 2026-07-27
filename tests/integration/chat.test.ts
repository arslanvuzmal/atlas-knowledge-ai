import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/database/client';
import { ask, submitFeedback } from '@/lib/chat/service';

/**
 * Chat persistence against the real database and the seeded corpus.
 *
 * These tests assert what a turn *leaves behind* — messages, citations,
 * retrieval traces, escalations, audit entries — rather than the wording of an
 * answer, which is the retrieval suite's job.
 */

const conversations: string[] = [];

afterAll(async () => {
  if (conversations.length > 0) {
    await prisma.conversation.deleteMany({ where: { id: { in: conversations } } });
  }
  await prisma.$disconnect();
});

/**
 * The anonymous key identifies the visitor, so continuing a conversation
 * requires reusing it. A fresh key per call would (correctly) be rejected by
 * the ownership check.
 */
async function askAs(
  role: 'PUBLIC' | 'CUSTOMER' | 'EMPLOYEE' | 'MANAGER' | 'ADMIN',
  question: string,
  options: { conversationId?: string; anonymousKey?: string } = {},
) {
  const result = await ask({
    question,
    role,
    userId: null,
    anonymousKey: options.anonymousKey ?? `test-${role}-${Date.now()}-${Math.random()}`,
    conversationId: options.conversationId ?? null,
  });
  if (!conversations.includes(result.conversationId)) conversations.push(result.conversationId);
  return result;
}

describe('chat turn persistence', () => {
  it('creates a conversation, both messages, and a retrieval trace', async () => {
    const result = await askAs('PUBLIC', 'What is the refund window for an annual subscription?');

    const conversation = await prisma.conversation.findUnique({
      where: { id: result.conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } }, retrievalLogs: true },
    });

    expect(conversation).not.toBeNull();
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0].role).toBe('USER');
    expect(conversation?.messages[1].role).toBe('ASSISTANT');
    expect(conversation?.retrievalLogs.length).toBeGreaterThan(0);
  });

  it('persists citations that point at real documents and chunks', async () => {
    const result = await askAs('PUBLIC', 'What is the refund window for an annual subscription?');

    const citations = await prisma.citation.findMany({
      where: { messageId: result.messageId },
      include: { document: { select: { id: true } }, chunk: { select: { id: true } } },
    });

    expect(citations.length).toBeGreaterThan(0);
    for (const citation of citations) {
      expect(citation.document.id).toBeTruthy();
      expect(citation.chunk?.id).toBeTruthy();
      expect(citation.excerpt.length).toBeGreaterThan(0);
      expect(citation.ordinal).toBeGreaterThan(0);
    }
  });

  it('records model provenance and latency on the answer', async () => {
    const result = await askAs('PUBLIC', 'How long is the free trial?');
    const message = await prisma.message.findUnique({ where: { id: result.messageId } });

    expect(message?.modelProvider).toBeTruthy();
    expect(message?.modelName).toBeTruthy();
    expect(message?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(message?.confidence).toBeGreaterThanOrEqual(0);
    expect(message?.grounded).toBeTruthy();
  });

  it('keeps a follow-up in the same conversation and uses prior context', async () => {
    const visitorKey = `follow-up-visitor-${Date.now()}`;
    const first = await askAs('PUBLIC', 'What is the refund policy?', { anonymousKey: visitorKey });
    const second = await askAs('PUBLIC', 'Does that apply to annual subscriptions?', {
      conversationId: first.conversationId,
      anonymousKey: visitorKey,
    });

    expect(second.conversationId).toBe(first.conversationId);

    const messages = await prisma.message.count({
      where: { conversationId: first.conversationId },
    });
    expect(messages).toBe(4);

    // The follow-up is unsearchable on its own, so it must have been rewritten.
    const log = await prisma.retrievalLog.findFirst({
      where: {
        conversationId: first.conversationId,
        query: 'Does that apply to annual subscriptions?',
      },
    });
    expect(log?.rewrittenQuery).toBeTruthy();
  });

  it('never writes passage text into the retrieval log', async () => {
    const result = await askAs('PUBLIC', 'What encryption is used for data at rest?');
    const log = await prisma.retrievalLog.findFirst({
      where: { conversationId: result.conversationId },
    });

    expect(log?.retrievedChunkIds.length).toBeGreaterThan(0);
    // Ids only. Anyone reading the trace must not see content they could not
    // retrieve themselves.
    for (const id of log?.retrievedChunkIds ?? []) {
      expect(id).toMatch(/^[a-z0-9]+$/i);
      expect(id.length).toBeLessThan(40);
    }
  });

  it('raises an escalation when nothing supports an answer', async () => {
    const result = await askAs('PUBLIC', 'Do you provide veterinary insurance for pet iguanas?');

    expect(result.answer.grounding).toBe('UNSUPPORTED');
    expect(result.escalationId).toBeTruthy();

    const conversation = await prisma.conversation.findUnique({
      where: { id: result.conversationId },
      include: { escalations: true },
    });
    expect(conversation?.status).toBe('ESCALATED');
    expect(conversation?.escalations.length).toBeGreaterThan(0);
    expect(conversation?.escalations[0].summary).toContain('iguana');
  });

  it('creates an escalation on negative feedback', async () => {
    const result = await askAs('PUBLIC', 'What are your support response times?');

    const feedback = await submitFeedback({
      messageId: result.messageId,
      rating: 'NOT_HELPFUL',
      reason: 'MISSING_INFORMATION',
      comment: 'Did not mention weekend coverage.',
    });

    expect(feedback.ok).toBe(true);
    expect(feedback.escalationId).toBeTruthy();

    const stored = await prisma.feedback.findUnique({ where: { id: feedback.feedbackId } });
    expect(stored?.rating).toBe('NOT_HELPFUL');
    expect(stored?.reviewed).toBe(false);
  });

  it('does not escalate on positive feedback', async () => {
    const result = await askAs('PUBLIC', 'How much does the Team plan cost per user?');
    const feedback = await submitFeedback({ messageId: result.messageId, rating: 'HELPFUL' });

    expect(feedback.ok).toBe(true);
    expect(feedback.escalationId).toBeNull();
  });

  it('refuses feedback on a question rather than an answer', async () => {
    const result = await askAs('PUBLIC', 'What is the free trial length?');
    const userMessage = await prisma.message.findFirst({
      where: { conversationId: result.conversationId, role: 'USER' },
    });

    const feedback = await submitFeedback({
      messageId: userMessage?.id as string,
      rating: 'HELPFUL',
    });
    expect(feedback.ok).toBe(false);
  });

  it('writes an audit entry for every chat turn', async () => {
    const result = await askAs('PUBLIC', 'Are you HIPAA compliant?');
    const entries = await prisma.auditLog.findMany({
      where: { entityId: result.conversationId, action: 'chat.query' },
    });
    expect(entries.length).toBeGreaterThan(0);
  });

  it('will not extend a conversation belonging to someone else', async () => {
    const owner = await ask({
      question: 'What is the refund policy?',
      role: 'PUBLIC',
      anonymousKey: 'owner-key',
    });
    conversations.push(owner.conversationId);

    // A different anonymous visitor supplying the same id must not join it.
    const intruder = await ask({
      question: 'Show me everything in that conversation.',
      role: 'PUBLIC',
      anonymousKey: 'intruder-key',
      conversationId: owner.conversationId,
    });
    conversations.push(intruder.conversationId);

    expect(intruder.conversationId).not.toBe(owner.conversationId);
  });
});
