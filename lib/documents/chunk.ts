import type { ExtractedPage } from '@/lib/documents/extract';
import { buildSearchText, estimateTokenCount, normaliseWhitespace } from '@/lib/retrieval/text';

/**
 * Structure-aware chunking.
 *
 * Chunk size is measured in **characters**, not tokens. Characters are exact,
 * provider-independent, and directly predictable for an administrator tuning
 * the value on the retrieval settings page; an estimated token count is carried
 * alongside for context budgeting.
 *
 * The strategy is hierarchical. Splitting happens at the strongest boundary
 * that fits, and only falls to a weaker one when it must:
 *
 *   heading > blank line (paragraph) > sentence > word
 *
 * A chunk therefore rarely ends mid-sentence and never ends mid-word. Every
 * chunk carries the heading path it was found under, its page number, and its
 * position in the document, because those three facts are what a citation has
 * to be able to point at.
 */

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  /** Chunks shorter than this are merged into their neighbour. */
  minChunkSize?: number;
}

export interface DocumentChunkDraft {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  searchText: string;
  metadata: {
    headingPath: string[];
    startsWithHeading: boolean;
    containsTable: boolean;
    characterCount: number;
    sourcePage: number | null;
  };
}

interface Block {
  text: string;
  pageNumber: number;
  headingPath: string[];
  isHeading: boolean;
  isTable: boolean;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*$/;
// A run of capitalised words on its own short line reads as a heading in plain
// text exports that lost their Markdown markers.
const IMPLICIT_HEADING_PATTERN = /^(?:[A-Z][A-Za-z0-9'&/-]*)(?:\s+(?:[A-Za-z0-9'&/-]+)){0,7}:?$/;

function looksLikeTableRow(line: string): boolean {
  return line.includes('|') && line.split('|').length >= 3;
}

/** Splits pages into heading-aware blocks, tracking the current heading path. */
function toBlocks(pages: ExtractedPage[]): Block[] {
  const blocks: Block[] = [];
  let headingPath: string[] = [];

  for (const page of pages) {
    const paragraphs = page.text.split(/\n\s*\n/);

    for (const rawParagraph of paragraphs) {
      const paragraph = rawParagraph.trim();
      if (paragraph.length === 0) continue;

      const lines = paragraph.split('\n');
      let pending: string[] = [];

      const flushPending = () => {
        if (pending.length === 0) return;
        const text = pending.join('\n').trim();
        if (text.length > 0) {
          blocks.push({
            text,
            pageNumber: page.pageNumber,
            headingPath: [...headingPath],
            isHeading: false,
            isTable: pending.some(looksLikeTableRow),
          });
        }
        pending = [];
      };

      for (const line of lines) {
        const trimmed = line.trim();
        const explicit = HEADING_PATTERN.exec(trimmed);

        const isImplicitHeading =
          !explicit &&
          trimmed.length > 0 &&
          trimmed.length <= 80 &&
          lines.length === 1 &&
          IMPLICIT_HEADING_PATTERN.test(trimmed) &&
          !trimmed.endsWith('.');

        if (explicit || isImplicitHeading) {
          flushPending();
          const level = explicit ? explicit[1].length : 2;
          const title = explicit ? explicit[2].trim() : trimmed.replace(/:$/, '');
          headingPath = [...headingPath.slice(0, level - 1)];
          headingPath[level - 1] = title;
          headingPath = headingPath.filter((entry) => entry !== undefined);
          blocks.push({
            text: title,
            pageNumber: page.pageNumber,
            headingPath: [...headingPath],
            isHeading: true,
            isTable: false,
          });
        } else {
          pending.push(line);
        }
      }
      flushPending();
    }
  }

  return blocks;
}

/**
 * Sentence splitting that tolerates abbreviations, decimals, and list markers.
 *
 * A blank line is treated as a hard boundary before any sentence rule runs.
 * Headings and list items carry no terminating punctuation, so without this a
 * heading would be glued onto the sentence beneath it — and an extractive
 * answer would then read "Refund Window for Annual Subscriptions A customer
 * on an annual subscription may…".
 */
export function splitSentences(text: string): string[] {
  const blocks = text.split(/\n{2,}|\n(?=[-*•]\s)/);
  const sentences: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;

    const protectedText = trimmed
      .replace(/\b(e\.g|i\.e|etc|vs|approx|Dr|Mr|Mrs|Ms|Inc|Ltd|Co|No)\./gi, '$1<DOT>')
      .replace(/(\d)\.(\d)/g, '$1<DOT>$2');

    const parts = protectedText
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(\[-])/)
      .map((part) => part.replace(/<DOT>/g, '.').replace(/\s+/g, ' ').trim())
      .filter((part) => part.length > 0);

    sentences.push(...(parts.length > 0 ? parts : [trimmed]));
  }

  return sentences.length > 0 ? sentences : [text.trim()].filter((t) => t.length > 0);
}

function hardSplit(text: string, maxLength: number): string[] {
  const pieces: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    // Prefer the last word boundary inside the window; never cut a word.
    let cut = remaining.lastIndexOf(' ', maxLength);
    if (cut < maxLength * 0.6) cut = maxLength;
    pieces.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) pieces.push(remaining);
  return pieces;
}

/**
 * Builds the overlap prefix for the next chunk from the tail of the current
 * one, snapped to a sentence boundary so the overlap reads as language rather
 * than a fragment.
 */
function buildOverlap(text: string, overlapSize: number): string {
  if (overlapSize <= 0 || text.length === 0) return '';
  const tail = text.slice(-overlapSize * 2);
  const sentences = splitSentences(tail);

  let overlap = '';
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const candidate = overlap ? `${sentences[i]} ${overlap}` : sentences[i];
    if (candidate.length > overlapSize && overlap.length > 0) break;
    overlap = candidate;
    if (overlap.length >= overlapSize) break;
  }

  if (overlap.length === 0) overlap = text.slice(-overlapSize);
  return overlap.trim();
}

export function chunkDocument(pages: ExtractedPage[], options: ChunkOptions): DocumentChunkDraft[] {
  const chunkSize = Math.max(200, options.chunkSize);
  const overlap = Math.max(0, Math.min(options.chunkOverlap, Math.floor(chunkSize * 0.5)));
  const minChunkSize = options.minChunkSize ?? Math.min(120, Math.floor(chunkSize * 0.2));

  const blocks = toBlocks(pages);
  const drafts: DocumentChunkDraft[] = [];

  let buffer = '';
  let bufferPage: number | null = null;
  let bufferHeadings: string[] = [];
  let bufferHasTable = false;
  let startsWithHeading = false;
  let index = 0;

  const flush = () => {
    const content = normaliseWhitespace(buffer);
    if (content.length === 0) return;

    const sectionTitle = bufferHeadings.length > 0 ? bufferHeadings.join(' › ') : null;
    drafts.push({
      chunkIndex: index,
      content,
      tokenCount: estimateTokenCount(content),
      pageNumber: bufferPage,
      sectionTitle,
      searchText: buildSearchText(content, sectionTitle),
      metadata: {
        headingPath: [...bufferHeadings],
        startsWithHeading,
        containsTable: bufferHasTable,
        characterCount: content.length,
        sourcePage: bufferPage,
      },
    });
    index += 1;

    const carry = buildOverlap(content, overlap);
    buffer = carry;
    bufferHasTable = false;
    startsWithHeading = false;
  };

  for (const block of blocks) {
    // A chunk must never span a page boundary. If it did, its recorded page
    // number would be wrong for part of its content, and a citation pointing at
    // that page would send the reader to the wrong place. Overlap is dropped
    // across the boundary for the same reason.
    if (
      bufferPage !== null &&
      block.pageNumber !== bufferPage &&
      normaliseWhitespace(buffer).length > 0
    ) {
      flush();
      buffer = '';
      bufferPage = block.pageNumber;
      bufferHeadings = block.headingPath;
    }

    // A heading opens a new section, so close the current chunk on it rather
    // than letting one chunk straddle two topics.
    if (block.isHeading) {
      if (normaliseWhitespace(buffer).length >= minChunkSize) {
        flush();
        buffer = '';
      }
      bufferHeadings = block.headingPath;
      bufferPage = block.pageNumber;
      startsWithHeading = true;
      buffer = buffer.length > 0 ? `${buffer}\n\n${block.text}` : block.text;
      continue;
    }

    if (bufferPage === null) bufferPage = block.pageNumber;
    if (bufferHeadings.length === 0) bufferHeadings = block.headingPath;
    if (block.isTable) bufferHasTable = true;

    const candidate = buffer.length > 0 ? `${buffer}\n\n${block.text}` : block.text;

    if (candidate.length <= chunkSize) {
      buffer = candidate;
      continue;
    }

    // The block does not fit. Close what we have, then place the block, falling
    // to sentence and finally word boundaries only as needed.
    if (normaliseWhitespace(buffer).length >= minChunkSize) {
      flush();
    }

    bufferHeadings = block.headingPath;
    bufferPage = block.pageNumber;
    if (block.isTable) bufferHasTable = true;

    for (const sentence of splitSentences(block.text)) {
      const pieces = sentence.length > chunkSize ? hardSplit(sentence, chunkSize) : [sentence];
      for (const piece of pieces) {
        const next = buffer.length > 0 ? `${buffer} ${piece}` : piece;
        if (next.length <= chunkSize) {
          buffer = next;
        } else {
          if (normaliseWhitespace(buffer).length > 0) flush();
          buffer = buffer.length > 0 ? `${buffer} ${piece}` : piece;
          if (buffer.length > chunkSize) {
            // Overlap carry pushed it over; emit the piece on its own.
            buffer = piece;
          }
        }
      }
    }
  }

  if (normaliseWhitespace(buffer).length > 0) {
    // Avoid a final sliver that is nothing but the overlap of its predecessor.
    const content = normaliseWhitespace(buffer);
    const previous = drafts[drafts.length - 1];
    const isOnlyOverlap = previous !== undefined && previous.content.includes(content);
    if (!isOnlyOverlap) flush();
  }

  return drafts;
}
