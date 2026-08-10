import { describe, expect, it } from 'vitest';
import { detectMaterialConflicts } from '@/lib/rag/conflict';
import type { RerankedChunk } from '@/lib/reranking';

function makeChunk(documentId: string, documentTitle: string, content: string): RerankedChunk {
  return {
    id: `chunk_${Math.random()}`,
    knowledgeBaseId: 'kb_1',
    documentId,
    documentVersionId: 'v1',
    chunkIndex: 0,
    content,
    pageNumber: 1,
    sectionTitle: null,
    accessLevel: 'PUBLIC',
    documentTitle,
    documentSourceType: 'TEXT',
    documentSourceUrl: null,
    retrievalScore: 0.85,
    rerankScore: 0.85,
    score: 0.85,
    signals: {
      coverage: 0.8,
      proximity: 0.8,
      rarity: 0.8,
      titleMatch: 0.8,
      lengthPenalty: 1.0,
    },
  };
}

describe('Material Conflict Detection Engine', () => {
  it('detects genuine numeric conflicts on the same subject and scope', () => {
    const chunk1 = makeChunk(
      'doc1',
      'Policy A',
      'Annual leave allowance is 25 days for all full-time employees.',
    );
    const chunk2 = makeChunk(
      'doc2',
      'Policy B',
      'Annual leave allowance is 30 days for all full-time employees.',
    );

    const result = detectMaterialConflicts(
      [chunk1, chunk2],
      'How many annual leave days do full-time employees get?',
    );

    expect(result.detected).toBe(true);
    expect(result.conflictingDocuments).toHaveLength(2);
    expect(result.conflictingDocuments.map((d) => d.documentId)).toEqual(['doc1', 'doc2']);
  });

  it('does NOT flag different subscription plan scopes as conflicts', () => {
    const chunk1 = makeChunk(
      'doc1',
      'Refund and Cancellation Policy',
      'The refund window for an annual subscription is 30 days from purchase.',
    );
    const chunk2 = makeChunk(
      'doc2',
      'Customer Support FAQ',
      'The refund window for a monthly subscription is 14 days from purchase.',
    );

    const result = detectMaterialConflicts(
      [chunk1, chunk2],
      'What is the refund window for an annual subscription?',
    );

    expect(result.detected).toBe(false);
  });

  it('does NOT flag different metrics (response time vs resolution time) as conflicts', () => {
    const chunk1 = makeChunk(
      'doc1',
      'SLA Guide',
      'First response time SLA is 2 hours for urgent tickets.',
    );
    const chunk2 = makeChunk(
      'doc2',
      'Support Escalation Guide',
      'Complete issue resolution time SLA is 24 hours for urgent tickets.',
    );

    const result = detectMaterialConflicts([chunk1, chunk2], 'What is the SLA response time?');

    expect(result.detected).toBe(false);
  });

  it('does NOT flag different time periods as conflicts', () => {
    const chunk1 = makeChunk('doc1', '2025 Policy', 'In 2025 annual leave is 20 days.');
    const chunk2 = makeChunk('doc2', '2026 Policy', 'In 2026 annual leave is 25 days.');

    const result = detectMaterialConflicts([chunk1, chunk2], 'How many leave days in 2026?');

    expect(result.detected).toBe(false);
  });

  it('does NOT flag unrelated negative wording as conflicts', () => {
    const chunk1 = makeChunk(
      'doc1',
      'Refund Policy',
      'Refunds are allowed for annual subscriptions within 30 days.',
    );
    const chunk2 = makeChunk(
      'doc2',
      'Security Policy',
      'Production passwords must not be shared under any circumstances.',
    );

    const result = detectMaterialConflicts([chunk1, chunk2], 'What is the refund policy?');

    expect(result.detected).toBe(false);
  });

  it('detects explicit semantic contradictions on the same entity', () => {
    const chunk1 = makeChunk(
      'doc1',
      'Security Policy',
      'HIPAA compliance is supported on the Team plan.',
    );
    const chunk2 = makeChunk(
      'doc2',
      'Compliance Matrix',
      'HIPAA compliance is unsupported on the Team plan.',
    );

    const result = detectMaterialConflicts([chunk1, chunk2], 'Is HIPAA supported on Team plan?');

    expect(result.detected).toBe(true);
    expect(result.conflictingDocuments).toHaveLength(2);
  });

  it('detects three-source conflicts correctly', () => {
    const chunk1 = makeChunk(
      'doc1',
      'Doc 1',
      'SLA notification clock starts within 24 hours of incident.',
    );
    const chunk2 = makeChunk(
      'doc2',
      'Doc 2',
      'SLA notification clock starts within 48 hours of incident.',
    );
    const chunk3 = makeChunk(
      'doc3',
      'Doc 3',
      'SLA notification clock starts within 72 hours of incident.',
    );

    const result = detectMaterialConflicts(
      [chunk1, chunk2, chunk3],
      'When does SLA notification clock start?',
    );

    expect(result.detected).toBe(true);
    expect(result.conflictingDocuments.length).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates duplicate evidence from the same document', () => {
    const chunk1 = makeChunk('doc1', 'Doc 1', 'Annual leave is 25 days.');
    const chunk2 = makeChunk('doc1', 'Doc 1', 'Annual leave is 25 days.');

    const result = detectMaterialConflicts([chunk1, chunk2], 'How many annual leave days?');

    expect(result.detected).toBe(false);
  });
});
