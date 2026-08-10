import type { RerankedChunk } from '@/lib/reranking';

export interface ConflictDocument {
  documentId: string;
  title: string;
  excerpt: string;
}

export interface ConflictResult {
  detected: boolean;
  conflictingDocuments: ConflictDocument[];
  reasoning?: string;
}

/**
 * Detects genuine material contradictions across retrieved knowledge chunks.
 *
 * A conflict requires:
 * 1. Same subject / entity (e.g. "Annual subscription refund window")
 * 2. Same property / metric (e.g. duration in days)
 * 3. Comparable scope (e.g. both apply to Annual plan; Annual vs Monthly are DIFFERENT scopes)
 * 4. Incompatible claims (e.g. 30 days vs 60 days for the SAME plan)
 */
export function detectMaterialConflicts(
  chunks: RerankedChunk[],
  question: string,
): ConflictResult {
  if (chunks.length < 2) {
    return { detected: false, conflictingDocuments: [] };
  }

  // Deduplicate chunks per document
  const uniqueDocChunks = new Map<string, RerankedChunk[]>();
  for (const chunk of chunks) {
    const existing = uniqueDocChunks.get(chunk.documentId) ?? [];
    if (!existing.some((e) => e.content === chunk.content)) {
      existing.push(chunk);
    }
    uniqueDocChunks.set(chunk.documentId, existing);
  }

  if (uniqueDocChunks.size < 2) {
    return { detected: false, conflictingDocuments: [] };
  }

  const normalizedQuestion = question.toLowerCase();

  // Scope & Metric modifiers to differentiate distinct policies/plans/metrics
  const scopeModifiers = [
    'annual',
    'monthly',
    'enterprise',
    'starter',
    'team',
    'free',
    'trial',
    'pro',
    'hipaa',
    'gdpr',
    'us',
    'eu',
    'q1',
    'q2',
    'q3',
    'q4',
    '2024',
    '2025',
    '2026',
    'response',
    'resolution',
    'first',
    'complete',
    'initial',
    'final',
    'uptime',
    'downtime',
    'ingestion',
    'processing',
  ];

  // Key terms from question
  const questionWords = normalizedQuestion
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 2 &&
        ![
          'what',
          'when',
          'where',
          'which',
          'how',
          'does',
          'that',
          'this',
          'for',
          'the',
          'and',
          'are',
          'with',
          'your',
        ].includes(w),
    );

  // --- 1. Numeric Claim Conflict Analysis ---
  const numberMetricPattern =
    /\b(\d+(?:\.\d+)?)\s*(days?|hours?|minutes?|months?|years?|percent|%|\$|USD|users?|seats?)\b/gi;

  interface ExtractedNumericClaim {
    documentId: string;
    title: string;
    value: number;
    unit: string;
    scopes: string[];
    topicTerms: string[];
    excerpt: string;
  }

  const extractedClaims: ExtractedNumericClaim[] = [];

  for (const [docId, docChunks] of uniqueDocChunks) {
    const title = docChunks[0].documentTitle;
    for (const chunk of docChunks) {
      const text = chunk.content;
      const lowerText = text.toLowerCase();
      const matches = [...text.matchAll(numberMetricPattern)];

      for (const match of matches) {
        const valNum = parseFloat(match[1]);
        const unit = match[2].toLowerCase().replace(/s$/, ''); // normalize days -> day
        const matchIdx = match.index ?? 0;
        const windowStart = Math.max(0, matchIdx - 120);
        const windowEnd = Math.min(text.length, matchIdx + match[0].length + 120);
        const contextWindow = lowerText.slice(windowStart, windowEnd);

        // Scopes present in this claim context
        const claimScopes = scopeModifiers.filter((s) => contextWindow.includes(s));

        // Substantive topic terms around the claim
        const topicTerms = contextWindow
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 3 &&
              !scopeModifiers.includes(w) &&
              ![
                'days',
                'hours',
                'months',
                'years',
                'percent',
                'with',
                'from',
                'than',
                'more',
                'less',
                'only',
                'within',
                'after',
                'before',
              ].includes(w),
          );

        extractedClaims.push({
          documentId: docId,
          title,
          value: valNum,
          unit,
          scopes: claimScopes,
          topicTerms,
          excerpt: text
            .slice(Math.max(0, matchIdx - 40), Math.min(text.length, matchIdx + match[0].length + 60))
            .trim(),
        });
      }
    }
  }

  const conflictingDocsMap = new Map<string, ConflictDocument>();

  for (let i = 0; i < extractedClaims.length; i++) {
    for (let j = i + 1; j < extractedClaims.length; j++) {
      const c1 = extractedClaims[i];
      const c2 = extractedClaims[j];

      // Must be from different documents
      if (c1.documentId === c2.documentId) continue;

      // Must share the same unit
      if (c1.unit !== c2.unit) continue;

      // Values must differ
      if (c1.value === c2.value) continue;

      // SCOPE CHECK: If one claim is specifically for 'annual' and another for 'monthly', they have DIFFERENT scopes! Not a conflict.
      const hasDivergentScope = scopeModifiers.some((sm) => {
        const c1Has = c1.scopes.includes(sm);
        const c2Has = c2.scopes.includes(sm);
        return (c1Has && !c2Has) || (!c1Has && c2Has);
      });

      if (hasDivergentScope) continue;

      // TOPIC OVERLAP CHECK: Must share at least 1 significant topic term in common
      const commonTopics = c1.topicTerms.filter((t) => c2.topicTerms.includes(t));
      if (commonTopics.length === 0) continue;

      // QUESTION RELEVANCE: Common topic must overlap with question terms if question terms exist
      if (questionWords.length > 0) {
        const matchesQuestion = commonTopics.some((t) =>
          questionWords.some((qw) => t.includes(qw) || qw.includes(t)),
        );
        if (!matchesQuestion) continue;
      }

      // True conflict!
      conflictingDocsMap.set(c1.documentId, {
        documentId: c1.documentId,
        title: c1.title,
        excerpt: c1.excerpt,
      });
      conflictingDocsMap.set(c2.documentId, {
        documentId: c2.documentId,
        title: c2.title,
        excerpt: c2.excerpt,
      });
    }
  }

  // --- 2. Explicit Semantic Contradiction Analysis ---
  const strictContradictions: [string, string][] = [
    ['allowed', 'prohibited'],
    ['supported', 'unsupported'],
    ['required', 'optional'],
    ['mandatory', 'optional'],
    ['included', 'excluded'],
    ['enabled', 'disabled'],
  ];

  for (const [pos, neg] of strictContradictions) {
    const posChunk = chunks.find((c) => c.content.toLowerCase().includes(pos));
    const negChunk = chunks.find(
      (c) => c.content.toLowerCase().includes(neg) && c.documentId !== posChunk?.documentId,
    );

    if (posChunk && negChunk) {
      const posLower = posChunk.content.toLowerCase();
      const negLower = negChunk.content.toLowerCase();

      const posWords = posLower.replace(/[^\w\s]/g, '').split(/\s+/).filter((w) => w.length > 4);
      const negWords = negLower.replace(/[^\w\s]/g, '').split(/\s+/).filter((w) => w.length > 4);
      const overlap = posWords.filter((w) => negWords.includes(w) && questionWords.includes(w));

      if (overlap.length >= 1) {
        conflictingDocsMap.set(posChunk.documentId, {
          documentId: posChunk.documentId,
          title: posChunk.documentTitle,
          excerpt: posChunk.content.slice(0, 150).trim(),
        });
        conflictingDocsMap.set(negChunk.documentId, {
          documentId: negChunk.documentId,
          title: negChunk.documentTitle,
          excerpt: negChunk.content.slice(0, 150).trim(),
        });
      }
    }
  }

  const conflictingDocuments = Array.from(conflictingDocsMap.values());

  return {
    detected: conflictingDocuments.length >= 2,
    conflictingDocuments: conflictingDocuments.slice(0, 4),
  };
}
