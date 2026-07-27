import type { SourceType } from '@prisma/client';
import { normaliseWhitespace } from '@/lib/retrieval/text';

/**
 * Text extraction.
 *
 * Every extractor returns the same shape: an ordered list of pages, each with
 * its text. Formats without real pagination return a single page, and the
 * chunker derives section structure from headings instead. Page identity is
 * preserved here because it is what a citation ultimately points at.
 */

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  pages: ExtractedPage[];
  /** Concatenated text, used for checksums and full-text preview. */
  fullText: string;
  pageCount: number;
  characterCount: number;
  warnings: string[];
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'unsupported' | 'corrupted' | 'empty' | 'too_large',
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const MIN_USEFUL_CHARACTERS = 20;

function assembleResult(pages: ExtractedPage[], warnings: string[]): ExtractionResult {
  const cleaned = pages
    .map((page) => ({ pageNumber: page.pageNumber, text: normaliseWhitespace(page.text) }))
    .filter((page) => page.text.length > 0);

  const fullText = cleaned.map((page) => page.text).join('\n\n');

  if (fullText.replace(/\s/g, '').length < MIN_USEFUL_CHARACTERS) {
    throw new ExtractionError(
      'No readable text could be extracted. The file may be empty, corrupted, or a scanned image without an OCR text layer.',
      'empty',
    );
  }

  return {
    pages: cleaned,
    fullText,
    pageCount: cleaned.length,
    characterCount: fullText.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export async function extractPdf(bytes: Buffer): Promise<ExtractionResult> {
  const warnings: string[] = [];
  let pageTexts: string[];

  try {
    // Imported lazily: pdf.js is heavy and only a minority of uploads are PDFs.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const result = await extractText(document, { mergePages: false });
    pageTexts = Array.isArray(result.text) ? result.text : [String(result.text)];
  } catch (error) {
    throw new ExtractionError(
      `The PDF could not be parsed. It may be corrupted, encrypted, or password protected. (${
        error instanceof Error ? error.message : 'unknown parser error'
      })`,
      'corrupted',
    );
  }

  const pages = pageTexts.map((text, index) => ({ pageNumber: index + 1, text: text ?? '' }));
  const emptyPages = pages.filter((p) => p.text.trim().length === 0).length;
  if (emptyPages > 0 && emptyPages < pages.length) {
    warnings.push(
      `${emptyPages} of ${pages.length} pages contained no extractable text and were skipped. Scanned pages require OCR, which this build does not perform.`,
    );
  }

  return assembleResult(pages, warnings);
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

/**
 * Converts the narrow HTML subset mammoth emits into heading-preserving
 * Markdown. Headings matter because the chunker uses them as section
 * boundaries and as citation labels.
 */
export function docxHtmlToMarkdown(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_match, level: string, content: string) => {
      return `\n\n${'#'.repeat(Number.parseInt(level, 10))} ${stripTags(content)}\n\n`;
    })
    .replace(/<li[^>]*>(.*?)<\/li>/gis, (_match, content: string) => `\n- ${stripTags(content)}`)
    .replace(/<\/(ul|ol)>/gi, '\n\n')
    .replace(/<(ul|ol)[^>]*>/gi, '\n')
    .replace(/<t[hd][^>]*>(.*?)<\/t[hd]>/gis, (_m, content: string) => `${stripTags(content)} | `)
    .replace(/<\/tr>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gis, (_match, content: string) => `\n\n${stripTags(content)}\n\n`)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractDocx(bytes: Buffer): Promise<ExtractionResult> {
  let markdown: string;
  const warnings: string[] = [];

  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ buffer: bytes });
    markdown = docxHtmlToMarkdown(result.value);
    for (const message of result.messages.slice(0, 5)) {
      if (message.type === 'warning') warnings.push(message.message);
    }
  } catch (error) {
    throw new ExtractionError(
      `The Word document could not be parsed. It may be corrupted or in an unsupported legacy format. (${
        error instanceof Error ? error.message : 'unknown parser error'
      })`,
      'corrupted',
    );
  }

  return assembleResult([{ pageNumber: 1, text: markdown }], warnings);
}

// ---------------------------------------------------------------------------
// Plain text and Markdown
// ---------------------------------------------------------------------------

export async function extractPlainText(bytes: Buffer): Promise<ExtractionResult> {
  const text = bytes.toString('utf8').replace(/^﻿/, '');
  return assembleResult([{ pageNumber: 1, text }], []);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, embedded newlines. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/**
 * Renders CSV as labelled records rather than a raw grid. "Plan: Team, Monthly
 * price: 79" retrieves far better than a bare comma-separated line, because the
 * column name travels with every value.
 */
export async function extractCsv(bytes: Buffer): Promise<ExtractionResult> {
  const rows = parseCsv(bytes.toString('utf8').replace(/^﻿/, ''));
  if (rows.length === 0) {
    throw new ExtractionError('The CSV file contained no rows.', 'empty');
  }

  const warnings: string[] = [];
  const [header, ...dataRows] = rows;
  const headers = header.map((h) => h.trim());

  if (dataRows.length === 0) {
    throw new ExtractionError('The CSV file contained a header but no data rows.', 'empty');
  }
  if (dataRows.length > 5000) {
    warnings.push(`Only the first 5000 of ${dataRows.length} rows were indexed.`);
  }

  const lines = dataRows.slice(0, 5000).map((cells, index) => {
    const pairs = headers
      .map((name, column) => {
        const value = (cells[column] ?? '').trim();
        return value.length > 0 ? `${name}: ${value}` : null;
      })
      .filter((entry): entry is string => entry !== null);
    return `Record ${index + 1} — ${pairs.join('; ')}`;
  });

  const text = `Columns: ${headers.join(', ')}\n\n${lines.join('\n')}`;
  return assembleResult([{ pageNumber: 1, text }], warnings);
}

// ---------------------------------------------------------------------------
// HTML (website ingestion)
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&[a-z]+;|&#\d+;|&#x[0-9a-f]+;/gi, (entity) => {
    const named = HTML_ENTITIES[entity.toLowerCase()];
    if (named) return named;
    const decimal = /^&#(\d+);$/.exec(entity);
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal[1], 10));
    const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
    if (hex) return String.fromCodePoint(Number.parseInt(hex[1], 16));
    return entity;
  });
}

/**
 * Extracts readable content from an HTML page.
 *
 * Non-content regions (script, style, nav, header, footer, aside, forms) are
 * dropped before conversion, and heading structure is preserved as Markdown so
 * the chunker can build sections from it.
 */
export function htmlToStructuredText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[1])).trim() || null : null;

  let body = html;
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) body = bodyMatch[1];

  const text = body
    .replace(/<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, content: string) => {
      return `\n\n${'#'.repeat(Number.parseInt(level, 10))} ${stripTags(content)}\n\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, content: string) => `\n- ${stripTags(content)}`)
    .replace(
      /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi,
      (_m, content: string) => `${stripTags(content)} | `,
    )
    .replace(/<\/tr>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');

  return {
    title,
    text: decodeHtmlEntities(text)
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n'),
  };
}

export async function extractHtml(
  html: string,
): Promise<ExtractionResult & { title: string | null }> {
  const { title, text } = htmlToStructuredText(html);
  const result = assembleResult([{ pageNumber: 1, text }], []);
  return { ...result, title };
}

// ---------------------------------------------------------------------------

export async function extractBySourceType(
  sourceType: SourceType,
  bytes: Buffer,
): Promise<ExtractionResult> {
  switch (sourceType) {
    case 'PDF':
      return extractPdf(bytes);
    case 'DOCX':
      return extractDocx(bytes);
    case 'CSV':
      return extractCsv(bytes);
    case 'TXT':
    case 'MARKDOWN':
    case 'FAQ':
    case 'MANUAL_ENTRY':
      return extractPlainText(bytes);
    case 'WEBSITE':
      return extractHtml(bytes.toString('utf8'));
    default:
      throw new ExtractionError(`No extractor is registered for "${sourceType}".`, 'unsupported');
  }
}
