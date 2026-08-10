import type { AccessLevel, Role } from '@prisma/client';
import { keywordSearch, vectorSearch, type RetrievedChunkRow } from '@/lib/database/vector';
import { embedQuery } from '@/lib/embeddings';
import { allowedAccessLevels, canReadAccessLevel } from '@/lib/auth/rbac';
import { rerank, reciprocalRankFusion, type RerankedChunk } from '@/lib/reranking';
import {
  calculateConfidence,
  determineGrounding,
  type ConfidenceBreakdown,
} from '@/lib/retrieval/confidence';
import { prepareQuery, type ConversationTurn, type QueryPreparation } from '@/lib/retrieval/query';
import type { RetrievalSettings } from '@/lib/retrieval/settings';
import { logger } from '@/lib/observability/logger';
import type { GroundingLevel } from '@prisma/client';

/**
 * The retrieval pipeline.
 *
 * Access control is applied twice, deliberately:
 *
 *   1. **Before search**, as a SQL predicate, so restricted chunks are never
 *      read out of the database.
 *   2. **After reranking**, as a defence-in-depth assertion in application
 *      code. If step 1 were ever weakened by a query change, step 2 still
 *      prevents the leak and logs it loudly.
 *
 * Nothing between those two points can widen the caller's reach: query
 * rewriting alters the search string only, and document text is never treated
 * as instructions.
 */

export interface RetrievalRequest {
  question: string;
  role: Role;
  knowledgeBaseId?: string | null;
  documentId?: string | null;
  history?: ConversationTurn[];
  settings: RetrievalSettings;
  traceId?: string;
}

export interface RetrievalResult {
  chunks: RerankedChunk[];
  confidence: ConfidenceBreakdown;
  grounding: GroundingLevel;
  preparation: QueryPreparation;
  allowedLevels: AccessLevel[];
  stats: {
    vectorCandidates: number;
    keywordCandidates: number;
    fusedCandidates: number;
    afterAccessFilter: number;
    rerankedCount: number;
    latencyMs: number;
    hybrid: boolean;
    /** Non-zero indicates a bug in the SQL filter; always zero in normal operation. */
    droppedByPostFilter: number;
  };
}

export async function retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
  const started = Date.now();
  const { settings, role } = request;
  const allowed = allowedAccessLevels(role);

  const preparation = prepareQuery(request.question, request.history ?? [], {
    enabled: settings.queryRewriting,
    historyLength: settings.conversationHistoryLength,
  });

  const filters = {
    allowedAccessLevels: allowed,
    knowledgeBaseId: request.knowledgeBaseId ?? null,
    documentId: request.documentId ?? null,
    limit: settings.retrievalCount,
    queryText: preparation.effective,
  };

  const queryVector = await embedQuery(preparation.effective);

  // Over-fetch on the lexical side: fusion benefits from a deeper second list,
  // and reranking will cut it back down.
  const [vectorRows, keywordRows] = await Promise.all([
    vectorSearch(queryVector, filters),
    settings.hybridSearch
      ? keywordSearch(preparation.effective, { ...filters, limit: settings.retrievalCount })
      : Promise.resolve([] as RetrievedChunkRow[]),
  ]);

  const fused = settings.hybridSearch
    ? reciprocalRankFusion([vectorRows, keywordRows])
    : vectorRows.map((row, index) => ({ ...row, retrievalScore: 1 / (60 + index + 1) }));

  // Defence in depth. The SQL filter above should make this a no-op.
  const permitted = fused.filter((row) => canReadAccessLevel(role, row.accessLevel));
  const droppedByPostFilter = fused.length - permitted.length;
  if (droppedByPostFilter > 0) {
    logger.error('Access-filter mismatch: restricted chunks survived the SQL predicate', {
      role,
      droppedByPostFilter,
      traceId: request.traceId,
    });
  }

  const reranked = rerank(preparation.effective, permitted, settings.rerankCount);
  const confidence = calculateConfidence(preparation.effective, reranked);
  const grounding = determineGrounding(confidence, settings.confidenceThreshold);

  return {
    chunks: reranked,
    confidence,
    grounding,
    preparation,
    allowedLevels: allowed,
    stats: {
      vectorCandidates: vectorRows.length,
      keywordCandidates: keywordRows.length,
      fusedCandidates: fused.length,
      afterAccessFilter: permitted.length,
      rerankedCount: reranked.length,
      latencyMs: Date.now() - started,
      hybrid: settings.hybridSearch,
      droppedByPostFilter,
    },
  };
}

/**
 * Related sources to offer when an answer is unsupported.
 *
 * Only document titles the caller is permitted to read are returned. This is
 * the path by which a restricted title could otherwise leak through a
 * "did you mean" affordance, so it filters on the same allowed set.
 */
export function suggestRelatedSources(
  chunks: RerankedChunk[],
  role: Role,
  limit = 3,
): { documentId: string; title: string; sectionTitle: string | null }[] {
  const seen = new Set<string>();
  const suggestions: { documentId: string; title: string; sectionTitle: string | null }[] = [];

  for (const chunk of chunks) {
    if (!canReadAccessLevel(role, chunk.accessLevel)) continue;
    if (seen.has(chunk.documentId)) continue;
    seen.add(chunk.documentId);
    suggestions.push({
      documentId: chunk.documentId,
      title: chunk.documentTitle,
      sectionTitle: chunk.sectionTitle,
    });
    if (suggestions.length >= limit) break;
  }

  return suggestions;
}
