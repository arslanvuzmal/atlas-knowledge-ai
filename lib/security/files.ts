import path from 'node:path';
import type { SourceType } from '@prisma/client';

/**
 * Upload validation: filename hygiene, extension/MIME agreement, size limits,
 * and magic-byte sniffing.
 *
 * The declared `Content-Type` on a multipart upload is attacker-controlled, so
 * it is treated as a hint that must agree with both the extension and the
 * actual leading bytes of the file.
 */

export interface FileTypeSpec {
  sourceType: SourceType;
  extensions: string[];
  mimeTypes: string[];
  /** Leading byte signatures. Empty means the format has no reliable magic. */
  magic: number[][];
  label: string;
}

export const SUPPORTED_FILE_TYPES: FileTypeSpec[] = [
  {
    sourceType: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf', 'application/x-pdf'],
    magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
    label: 'PDF document',
  },
  {
    sourceType: 'DOCX',
    extensions: ['.docx'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
    ],
    magic: [[0x50, 0x4b, 0x03, 0x04]], // ZIP container
    label: 'Word document',
  },
  {
    sourceType: 'TXT',
    extensions: ['.txt', '.text'],
    mimeTypes: ['text/plain'],
    magic: [],
    label: 'Plain text',
  },
  {
    sourceType: 'MARKDOWN',
    extensions: ['.md', '.markdown'],
    mimeTypes: ['text/markdown', 'text/x-markdown', 'text/plain'],
    magic: [],
    label: 'Markdown',
  },
  {
    sourceType: 'CSV',
    extensions: ['.csv'],
    mimeTypes: ['text/csv', 'application/csv', 'text/plain'],
    magic: [],
    label: 'CSV data',
  },
];

export const SUPPORTED_EXTENSIONS = SUPPORTED_FILE_TYPES.flatMap((t) => t.extensions);

export interface FileValidationInput {
  filename: string;
  mimeType?: string | null;
  size: number;
  bytes?: Buffer | Uint8Array | null;
  maxSizeBytes: number;
}

export interface FileValidationResult {
  ok: boolean;
  reason?: string;
  sourceType?: SourceType;
  safeFilename?: string;
  extension?: string;
}

const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * Reduces an uploaded filename to a safe basename.
 *
 * Strips directory components (defeating `../../etc/passwd` and
 * `..\\..\\windows\\system32`), control characters, and characters that are
 * unsafe on either POSIX or Windows filesystems. Always returns a non-empty
 * name.
 */
export function sanitiseFilename(input: string): string {
  if (!input) return 'untitled';

  // Take the basename under both separator conventions before anything else.
  let name = input.replace(/\\/g, '/').split('/').pop() ?? '';

  name = name
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[<>:"|?*]/g, '')
    // Leading dots would produce hidden files; runs of dots are traversal bait.
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const extension = path.extname(name).toLowerCase();
  let stem = extension ? name.slice(0, -extension.length) : name;

  stem = stem
    .replace(/[^A-Za-z0-9 ._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .trim();

  if (RESERVED_WINDOWS_NAMES.has(stem.toLowerCase())) {
    stem = `file_${stem}`;
  }
  if (stem.length === 0) stem = 'untitled';
  if (stem.length > 120) stem = stem.slice(0, 120);

  const safeExtension = /^\.[A-Za-z0-9]{1,10}$/.test(extension) ? extension : '';
  return `${stem}${safeExtension}`;
}

/** True when the resolved path escapes the intended root directory. */
export function isPathWithinRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(root, candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function specForExtension(extension: string): FileTypeSpec | undefined {
  const normalised = extension.toLowerCase();
  return SUPPORTED_FILE_TYPES.find((spec) => spec.extensions.includes(normalised));
}

function magicMatches(spec: FileTypeSpec, bytes: Buffer | Uint8Array): boolean {
  if (spec.magic.length === 0) return true;
  return spec.magic.some((signature) => signature.every((byte, index) => bytes[index] === byte));
}

/** Rejects binary payloads masquerading as text. */
function looksLikeText(bytes: Buffer | Uint8Array): boolean {
  const sample = bytes.slice(0, 4096);
  if (sample.length === 0) return true;
  let suspicious = 0;
  for (const byte of sample) {
    // NUL never appears in legitimate UTF-8 text.
    if (byte === 0x00) return false;
    const isPrintable = byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (!isPrintable) suspicious += 1;
  }
  return suspicious / sample.length < 0.1;
}

export function validateUpload(input: FileValidationInput): FileValidationResult {
  const safeFilename = sanitiseFilename(input.filename);
  const extension = path.extname(safeFilename).toLowerCase();

  if (!extension) {
    return { ok: false, reason: 'The file has no extension, so its type cannot be determined.' };
  }

  const spec = specForExtension(extension);
  if (!spec) {
    return {
      ok: false,
      reason: `Files of type "${extension}" are not supported. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
    };
  }

  if (input.size <= 0) {
    return { ok: false, reason: 'The file is empty.' };
  }
  if (input.size > input.maxSizeBytes) {
    const limitMb = (input.maxSizeBytes / (1024 * 1024)).toFixed(0);
    const actualMb = (input.size / (1024 * 1024)).toFixed(1);
    return { ok: false, reason: `The file is ${actualMb} MB, above the ${limitMb} MB limit.` };
  }

  // The declared MIME type must not contradict the extension. An unknown or
  // generic type is tolerated because browsers are inconsistent about it.
  const declared = (input.mimeType ?? '').split(';')[0].trim().toLowerCase();
  const genericTypes = ['', 'application/octet-stream', 'binary/octet-stream'];
  if (!genericTypes.includes(declared) && !spec.mimeTypes.includes(declared)) {
    return {
      ok: false,
      reason: `Declared content type "${declared}" does not match a "${extension}" file.`,
    };
  }

  if (input.bytes && input.bytes.length > 0) {
    if (!magicMatches(spec, input.bytes)) {
      return {
        ok: false,
        reason: `The file contents do not match a valid ${spec.label}. It may be corrupted or renamed.`,
      };
    }
    if (spec.magic.length === 0 && !looksLikeText(input.bytes)) {
      return {
        ok: false,
        reason: `The file is declared as ${spec.label} but contains binary data.`,
      };
    }
  }

  return { ok: true, sourceType: spec.sourceType, safeFilename, extension };
}
