import type { AccessLevel } from '@prisma/client';
import { prisma } from '@/lib/database/client';

/**
 * Dashboard analytics.
 *
 * Every number here is computed from the database at request time. Nothing is
 * hard-coded, estimated, or carried over from a fixture. When the demo data set
 * is reseeded these figures change accordingly, which is the point: they
 * demonstrate a working measurement pipeline rather than a designed screenshot.
 */

export interface OverviewMetrics {
  documents: {
    total: number;
    indexed: number;
    failed: number;
    processing: number;
    archived: number;
    chunks: number;
  };
  conversations: {
    total: number;
    questions: number;
    escalated: number;
  };
  quality: {
    groundedRate: number;
    partiallyGroundedRate: number;
    unsupportedRate: number;
    averageConfidence: number;
    answeredWithCitations: number;
  };
  feedback: {
    total: number;
    positive: number;
    partial: number;
    negative: number;
    positiveRate: number;
    negativeRate: number;
    unreviewed: number;
  };
  escalations: {
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
  };
  performance: {
    averageRetrievalLatencyMs: number;
    p95RetrievalLatencyMs: number;
    totalRetrievals: number;
  };
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  const [
    documentGroups,
    chunkCount,
    conversationCount,
    questionCount,
    escalatedConversations,
    assistantMessages,
    groundingGroups,
    confidenceAggregate,
    citedMessageCount,
    feedbackGroups,
    unreviewedFeedback,
    escalationGroups,
    latencyRows,
  ] = await Promise.all([
    prisma.document.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.documentChunk.count(),
    prisma.conversation.count(),
    prisma.message.count({ where: { role: 'USER' } }),
    prisma.conversation.count({ where: { status: 'ESCALATED' } }),
    prisma.message.count({ where: { role: 'ASSISTANT' } }),
    prisma.message.groupBy({
      by: ['grounded'],
      where: { role: 'ASSISTANT', grounded: { not: null } },
      _count: { _all: true },
    }),
    prisma.message.aggregate({
      where: { role: 'ASSISTANT', confidence: { not: null } },
      _avg: { confidence: true },
    }),
    prisma.message.count({ where: { role: 'ASSISTANT', citations: { some: {} } } }),
    prisma.feedback.groupBy({ by: ['rating'], _count: { _all: true } }),
    prisma.feedback.count({ where: { reviewed: false } }),
    prisma.escalation.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.retrievalLog.findMany({
      select: { latencyMs: true },
      take: 2000,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const documentCountFor = (status: string) =>
    documentGroups.find((group) => group.status === status)?._count._all ?? 0;

  const groundingCountFor = (level: string) =>
    groundingGroups.find((group) => group.grounded === level)?._count._all ?? 0;

  const feedbackCountFor = (rating: string) =>
    feedbackGroups.find((group) => group.rating === rating)?._count._all ?? 0;

  const escalationCountFor = (status: string) =>
    escalationGroups.find((group) => group.status === status)?._count._all ?? 0;

  const totalDocuments = documentGroups.reduce((sum, group) => sum + group._count._all, 0);
  const totalFeedback = feedbackGroups.reduce((sum, group) => sum + group._count._all, 0);
  const totalEscalations = escalationGroups.reduce((sum, group) => sum + group._count._all, 0);

  const latencies = latencyRows.map((row) => row.latencyMs).sort((a, b) => a - b);
  const averageLatency =
    latencies.length === 0
      ? 0
      : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
  const p95Latency =
    latencies.length === 0
      ? 0
      : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];

  return {
    documents: {
      total: totalDocuments,
      indexed: documentCountFor('INDEXED'),
      failed: documentCountFor('FAILED'),
      processing:
        documentCountFor('UPLOADED') +
        documentCountFor('VALIDATING') +
        documentCountFor('EXTRACTING') +
        documentCountFor('CHUNKING') +
        documentCountFor('EMBEDDING'),
      archived: documentCountFor('ARCHIVED'),
      chunks: chunkCount,
    },
    conversations: {
      total: conversationCount,
      questions: questionCount,
      escalated: escalatedConversations,
    },
    quality: {
      groundedRate: rate(groundingCountFor('SUPPORTED'), assistantMessages),
      partiallyGroundedRate: rate(groundingCountFor('PARTIALLY_SUPPORTED'), assistantMessages),
      unsupportedRate: rate(groundingCountFor('UNSUPPORTED'), assistantMessages),
      averageConfidence: Number((confidenceAggregate._avg.confidence ?? 0).toFixed(4)),
      answeredWithCitations: citedMessageCount,
    },
    feedback: {
      total: totalFeedback,
      positive: feedbackCountFor('HELPFUL'),
      partial: feedbackCountFor('PARTIALLY_HELPFUL'),
      negative: feedbackCountFor('NOT_HELPFUL'),
      positiveRate: rate(feedbackCountFor('HELPFUL'), totalFeedback),
      negativeRate: rate(feedbackCountFor('NOT_HELPFUL'), totalFeedback),
      unreviewed: unreviewedFeedback,
    },
    escalations: {
      total: totalEscalations,
      open: escalationCountFor('OPEN'),
      inProgress: escalationCountFor('IN_PROGRESS') + escalationCountFor('ASSIGNED'),
      resolved: escalationCountFor('RESOLVED') + escalationCountFor('CLOSED'),
    },
    performance: {
      averageRetrievalLatencyMs: averageLatency,
      p95RetrievalLatencyMs: p95Latency,
      totalRetrievals: latencyRows.length,
    },
  };
}

export interface DocumentUsage {
  documentId: string;
  title: string;
  citationCount: number;
  accessLevel: AccessLevel;
}

/** Most-cited documents. A direct proxy for which sources are earning their keep. */
export async function getMostUsedDocuments(limit = 8): Promise<DocumentUsage[]> {
  const grouped = await prisma.citation.groupBy({
    by: ['documentId'],
    _count: { _all: true },
    orderBy: { _count: { documentId: 'desc' } },
    take: limit,
  });

  if (grouped.length === 0) return [];

  const documents = await prisma.document.findMany({
    where: { id: { in: grouped.map((row) => row.documentId) } },
    select: { id: true, title: true, accessLevel: true },
  });
  const byId = new Map(documents.map((document) => [document.id, document]));

  const usage: DocumentUsage[] = [];
  for (const row of grouped) {
    const document = byId.get(row.documentId);
    if (!document) continue;
    usage.push({
      documentId: row.documentId,
      title: document.title,
      citationCount: row._count._all,
      accessLevel: document.accessLevel,
    });
  }
  return usage;
}

export interface QuestionCluster {
  question: string;
  occurrences: number;
  averageConfidence: number;
}

/**
 * Most-asked questions, grouped by normalised text.
 *
 * Grouping is done in application code on a bounded recent window rather than
 * in SQL, because the useful key is the normalised question, not the exact
 * string a user typed.
 */
export async function getMostAskedQuestions(limit = 8): Promise<QuestionCluster[]> {
  const logs = await prisma.retrievalLog.findMany({
    select: { query: true, confidence: true },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  const clusters = new Map<string, { display: string; count: number; confidenceTotal: number }>();

  for (const log of logs) {
    const key = log.query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (key.length === 0) continue;
    const existing = clusters.get(key);
    if (existing) {
      existing.count += 1;
      existing.confidenceTotal += log.confidence;
    } else {
      clusters.set(key, { display: log.query, count: 1, confidenceTotal: log.confidence });
    }
  }

  return [...clusters.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((cluster) => ({
      question: cluster.display,
      occurrences: cluster.count,
      averageConfidence: Number((cluster.confidenceTotal / cluster.count).toFixed(3)),
    }));
}

/** Questions that retrieved poorly. These are the content gaps worth filling. */
export async function getLowConfidenceTopics(limit = 8): Promise<QuestionCluster[]> {
  const logs = await prisma.retrievalLog.findMany({
    where: { confidence: { lt: 0.5 } },
    select: { query: true, confidence: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const clusters = new Map<string, { display: string; count: number; confidenceTotal: number }>();
  for (const log of logs) {
    const key = log.query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (key.length === 0) continue;
    const existing = clusters.get(key);
    if (existing) {
      existing.count += 1;
      existing.confidenceTotal += log.confidence;
    } else {
      clusters.set(key, { display: log.query, count: 1, confidenceTotal: log.confidence });
    }
  }

  return [...clusters.values()]
    .sort((a, b) => b.count - a.count || a.confidenceTotal / a.count - b.confidenceTotal / b.count)
    .slice(0, limit)
    .map((cluster) => ({
      question: cluster.display,
      occurrences: cluster.count,
      averageConfidence: Number((cluster.confidenceTotal / cluster.count).toFixed(3)),
    }));
}

export interface DailyPoint {
  date: string;
  questions: number;
  averageConfidence: number;
}

/** Question volume and confidence over a trailing window, for the trend chart. */
export async function getDailyActivity(days = 14): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const logs = await prisma.retrievalLog.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, confidence: true },
  });

  const buckets = new Map<string, { count: number; confidenceTotal: number }>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    buckets.set(date.toISOString().slice(0, 10), { count: 0, confidenceTotal: 0 });
  }

  for (const log of logs) {
    const key = log.createdAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.confidenceTotal += log.confidence;
  }

  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    questions: bucket.count,
    averageConfidence:
      bucket.count === 0 ? 0 : Number((bucket.confidenceTotal / bucket.count).toFixed(3)),
  }));
}
