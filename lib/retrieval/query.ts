import { STOPWORDS, tokenise } from '@/lib/retrieval/text';

/**
 * Query preparation.
 *
 * Follow-up questions are the common case in a conversational knowledge base
 * ("Does that apply to annual subscriptions?"). Such a question is nearly
 * unsearchable on its own, so it is expanded with the topical terms of the
 * recent conversation before retrieval runs.
 *
 * The expansion is deterministic and rule-based rather than a model call. It
 * costs nothing, behaves identically in demo and live mode, and is inspectable
 * in the retrieval log, which matters because a rewritten query changes what
 * evidence the answer is built from.
 *
 * Crucially, rewriting only affects *what is searched for*. It cannot widen
 * *what may be read*: the access filter is applied separately in SQL against
 * the caller's role.
 */

/** Words that signal the question depends on earlier context. */
const REFERENTIAL_MARKERS = new Set([
  'that',
  'this',
  'those',
  'these',
  'it',
  'its',
  'they',
  'them',
  'their',
  'the same',
  'above',
  'previous',
  'former',
  'latter',
]);

const FOLLOW_UP_OPENERS =
  /^(and|but|so|also|what about|how about|does that|do those|is that|are those|can it|would that|what if|why|why not|then)\b/i;

export interface QueryPreparation {
  original: string;
  rewritten: string | null;
  /** The string retrieval should actually use. */
  effective: string;
  isFollowUp: boolean;
  reason: string | null;
}

export interface ConversationTurn {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
}

function topicalTerms(text: string, limit: number): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  // Longer terms first: they carry more topical weight than short ones.
  for (const token of tokenise(text).sort((a, b) => b.length - a.length)) {
    if (STOPWORDS.has(token) || token.length < 4) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= limit) break;
  }
  return terms;
}

export function detectFollowUp(question: string): { isFollowUp: boolean; reason: string | null } {
  const trimmed = question.trim();
  const words = trimmed.split(/\s+/);

  if (FOLLOW_UP_OPENERS.test(trimmed)) {
    return { isFollowUp: true, reason: 'The question opens with a continuation phrase.' };
  }

  const lower = trimmed.toLowerCase();
  const hasReferential = words.some((word) =>
    REFERENTIAL_MARKERS.has(word.toLowerCase().replace(/[^a-z]/g, '')),
  );
  if (hasReferential && words.length <= 14) {
    return { isFollowUp: true, reason: 'The question refers back to something not named in it.' };
  }

  // A very short question with almost no content words needs prior context.
  const contentTerms = tokenise(lower).filter((t) => !STOPWORDS.has(t));
  if (words.length <= 5 && contentTerms.length <= 2) {
    return { isFollowUp: true, reason: 'The question is too short to retrieve on its own.' };
  }

  return { isFollowUp: false, reason: null };
}

export function prepareQuery(
  question: string,
  history: ConversationTurn[],
  options: { enabled: boolean; historyLength: number },
): QueryPreparation {
  const original = question.trim();

  if (!options.enabled || history.length === 0) {
    return { original, rewritten: null, effective: original, isFollowUp: false, reason: null };
  }

  const { isFollowUp, reason } = detectFollowUp(original);
  if (!isFollowUp) {
    return { original, rewritten: null, effective: original, isFollowUp: false, reason: null };
  }

  // Only previous *user* turns contribute topic terms. An assistant turn is not
  // a source of truth, and treating it as one would let a bad answer steer the
  // next retrieval.
  const recentUserTurns = history
    .filter((turn) => turn.role === 'USER')
    .slice(-Math.max(1, options.historyLength))
    .map((turn) => turn.content);

  if (recentUserTurns.length === 0) {
    return { original, rewritten: null, effective: original, isFollowUp: true, reason };
  }

  const existing = new Set(tokenise(original));
  const context = topicalTerms(recentUserTurns.join(' '), 6).filter((term) => !existing.has(term));

  if (context.length === 0) {
    return { original, rewritten: null, effective: original, isFollowUp: true, reason };
  }

  const rewritten = `${original} ${context.join(' ')}`;
  return { original, rewritten, effective: rewritten, isFollowUp: true, reason };
}

export const MAX_QUESTION_LENGTH = 2000;

export function validateQuestion(
  input: unknown,
): { ok: true; question: string } | { ok: false; reason: string } {
  if (typeof input !== 'string') return { ok: false, reason: 'A question is required.' };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'A question is required.' };
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return { ok: false, reason: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` };
  }
  return { ok: true, question: trimmed };
}
