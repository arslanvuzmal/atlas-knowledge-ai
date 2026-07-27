/**
 * Shared text normalisation.
 *
 * The demo embedding provider, the keyword half of hybrid search, and the
 * reranker all tokenise the same way. Keeping one implementation means a query
 * and a stored chunk can never disagree about what a "word" is.
 */

export const STOPWORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'own',
  'same',
  'she',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'us',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'you',
  'your',
  'yours',
]);

/**
 * Light suffix stripping. Not a full Porter stemmer: it handles the plural and
 * tense variation that actually matters for this corpus ("refund" / "refunds" /
 * "refunded" / "refunding") without the over-stemming that a full algorithm
 * causes on short domain terms.
 */
export function stem(token: string): string {
  let word = token;
  if (word.length <= 3) return word;

  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ses') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    word = word.slice(0, -1);
  }
  if (word.length > 5 && word.endsWith('ing')) {
    word = word.slice(0, -3);
    if (word.length > 2 && word[word.length - 1] === word[word.length - 2]) {
      word = word.slice(0, -1);
    }
  } else if (word.length > 4 && word.endsWith('ed') && !word.endsWith('eed')) {
    word = word.slice(0, -2);
  }
  if (word.length > 5 && word.endsWith('ly')) word = word.slice(0, -2);
  return word;
}

export interface TokeniseOptions {
  keepStopwords?: boolean;
  applyStemming?: boolean;
  minLength?: number;
}

export function tokenise(text: string, options: TokeniseOptions = {}): string[] {
  const { keepStopwords = false, applyStemming = true, minLength = 2 } = options;
  if (!text) return [];

  const raw = text
    .toLowerCase()
    // Keep intra-word hyphens and dots (version numbers, "single-sign-on").
    .replace(/[^a-z0-9\s.\-_/]/g, ' ')
    .split(/\s+/);

  const tokens: string[] = [];
  for (const piece of raw) {
    const cleaned = piece.replace(/^[.\-_/]+|[.\-_/]+$/g, '');
    if (cleaned.length < minLength) continue;
    // A hyphenated compound contributes both the whole and its parts.
    const parts = cleaned.includes('-') ? [cleaned, ...cleaned.split('-')] : [cleaned];
    for (const part of parts) {
      if (part.length < minLength) continue;
      if (!keepStopwords && STOPWORDS.has(part)) continue;
      tokens.push(applyStemming ? stem(part) : part);
    }
  }
  return tokens;
}

/** Character n-grams, used to soften morphological and spelling variation. */
export function characterNgrams(token: string, size = 4): string[] {
  if (token.length <= size) return [token];
  const padded = `^${token}$`;
  const grams: string[] = [];
  for (let i = 0; i + size <= padded.length; i += 1) {
    grams.push(padded.slice(i, i + size));
  }
  return grams;
}

/** Term frequencies with sublinear scaling. */
export function termFrequencies(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const weighted = new Map<string, number>();
  for (const [token, count] of counts) {
    weighted.set(token, 1 + Math.log(count));
  }
  return weighted;
}

/** FNV-1a, seeded. Fast, dependency-free, and stable across processes. */
export function hash32(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Rough token estimate. Deliberately conservative for context budgeting. */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.trim().length / 4);
}

export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lowercased searchable projection stored alongside each chunk. */
export function buildSearchText(content: string, sectionTitle?: string | null): string {
  const tokens = tokenise(`${sectionTitle ?? ''} ${content}`);
  return [...new Set(tokens)].join(' ');
}
