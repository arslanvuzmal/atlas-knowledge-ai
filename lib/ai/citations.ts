import type { PromptSource } from '@/lib/ai/prompt';

/**
 * Citation extraction and validation.
 *
 * This is the enforcement point for "never fabricate a citation". Whatever the
 * model emits, only markers that map to a source actually supplied for this
 * question survive. Two failure modes are handled distinctly:
 *
 *  - **Out-of-range markers** ("[7]" when five sources were given) are stripped
 *    from the answer text and reported. A hallucinated marker must never reach
 *    the user as a clickable citation.
 *  - **Unused sources** are simply not cited. That is normal and not an error.
 *
 * Markers are then renumbered so the visible citation list is contiguous, which
 * keeps "[1][2]" in the prose consistent with the cards beneath it.
 */

const CITATION_PATTERN = /\[(\d{1,2})\]/g;

export interface ValidatedCitation {
  ordinal: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  excerpt: string;
  relevanceScore: number;
}

export interface CitationValidationResult {
  /** Answer text with invalid markers removed and valid ones renumbered. */
  text: string;
  citations: ValidatedCitation[];
  invalidMarkers: number[];
  hasCitations: boolean;
}

const MAX_EXCERPT_LENGTH = 320;

/** Trims an excerpt to a sentence boundary where possible. */
export function buildExcerpt(content: string, maxLength = MAX_EXCERPT_LENGTH): string {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;

  const window = cleaned.slice(0, maxLength);
  const lastStop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('? '),
    window.lastIndexOf('! '),
  );
  if (lastStop > maxLength * 0.5) return window.slice(0, lastStop + 1);
  const lastSpace = window.lastIndexOf(' ');
  return `${window.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

export function validateCitations(
  answerText: string,
  sources: PromptSource[],
  scoresByChunkId: Map<string, number> = new Map(),
): CitationValidationResult {
  const byOrdinal = new Map(sources.map((source) => [source.ordinal, source]));

  const invalidMarkers: number[] = [];
  const usedOrdinals: number[] = [];

  // First pass: discover which markers are real, in the order they appear.
  for (const match of answerText.matchAll(CITATION_PATTERN)) {
    const ordinal = Number.parseInt(match[1], 10);
    if (!byOrdinal.has(ordinal)) {
      if (!invalidMarkers.includes(ordinal)) invalidMarkers.push(ordinal);
      continue;
    }
    if (!usedOrdinals.includes(ordinal)) usedOrdinals.push(ordinal);
  }

  // Renumber to a contiguous 1..n sequence in order of first appearance.
  const renumber = new Map<number, number>();
  usedOrdinals.forEach((ordinal, index) => renumber.set(ordinal, index + 1));

  const text = answerText
    .replace(CITATION_PATTERN, (marker, digits: string) => {
      const ordinal = Number.parseInt(digits, 10);
      const mapped = renumber.get(ordinal);
      return mapped === undefined ? '' : `[${mapped}]`;
    })
    // Tidy the spacing left behind by any removed marker.
    .replace(/ {2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

  const citations: ValidatedCitation[] = usedOrdinals.map((ordinal) => {
    const source = byOrdinal.get(ordinal) as PromptSource;
    return {
      ordinal: renumber.get(ordinal) as number,
      chunkId: source.chunkId,
      documentId: source.documentId,
      documentTitle: source.documentTitle,
      sectionTitle: source.sectionTitle,
      pageNumber: source.pageNumber,
      excerpt: buildExcerpt(source.content),
      relevanceScore: scoresByChunkId.get(source.chunkId) ?? 0,
    };
  });

  return {
    text,
    citations,
    invalidMarkers,
    hasCitations: citations.length > 0,
  };
}

/**
 * Fallback for a supported answer that arrived with no markers at all.
 *
 * Rather than presenting an uncited claim, the strongest retrieved sources are
 * attached as the evidence the answer was drawn from. They are real retrieved
 * passages, never invented, and the answer's grounding label still reflects the
 * measured confidence.
 */
export function attachFallbackCitations(
  sources: PromptSource[],
  scoresByChunkId: Map<string, number>,
  limit: number,
): ValidatedCitation[] {
  return sources.slice(0, limit).map((source, index) => ({
    ordinal: index + 1,
    chunkId: source.chunkId,
    documentId: source.documentId,
    documentTitle: source.documentTitle,
    sectionTitle: source.sectionTitle,
    pageNumber: source.pageNumber,
    excerpt: buildExcerpt(source.content),
    relevanceScore: scoresByChunkId.get(source.chunkId) ?? 0,
  }));
}
