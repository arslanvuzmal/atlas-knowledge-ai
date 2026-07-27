import type { GenerationRequest, GenerationResult, LlmHealth, LlmProvider } from '@/lib/ai/types';
import { SOURCE_CLOSE, SOURCE_OPEN, UNSUPPORTED_ANSWER } from '@/lib/ai/prompt';
import { splitSentences } from '@/lib/documents/chunk';
import { STOPWORDS, tokenise } from '@/lib/retrieval/text';

/**
 * Deterministic demo answer generator.
 *
 * WHAT IT DOES: extractive composition. It parses the numbered source block out
 * of the prompt, scores every sentence in those sources against the question,
 * and assembles the highest-scoring sentences into an answer with a citation
 * marker after each one. When no sentence clears the relevance floor it returns
 * the standard unsupported response.
 *
 * WHY IT IS SAFE BY CONSTRUCTION: because it can only copy sentences that are
 * present in the retrieved sources, it is incapable of fabricating a fact or a
 * citation. It also cannot follow an instruction embedded in a document, since
 * it does not interpret text at all.
 *
 * WHAT IT IS NOT: it does not paraphrase, synthesise across sentences, or
 * reason. Answers read as curated extracts rather than prose. That is the
 * honest trade for running the whole platform with no API credentials, and the
 * interface labels it as demo output wherever it appears.
 */

interface ParsedSource {
  ordinal: number;
  header: string;
  content: string;
}

const HEADER_PATTERN = /^\[(\d+)\]\s+Document:\s*(.+)$/;

export function parsePromptSources(userContent: string): {
  question: string;
  sources: ParsedSource[];
} {
  const questionMatch = /QUESTION\n([\s\S]*?)(?:\n\nAnswer using only|$)/.exec(userContent);
  const question = questionMatch ? questionMatch[1].trim() : userContent.trim();

  const start = userContent.indexOf(SOURCE_OPEN);
  const end = userContent.indexOf(SOURCE_CLOSE);
  if (start === -1 || end === -1 || end <= start) {
    return { question, sources: [] };
  }

  const block = userContent.slice(start + SOURCE_OPEN.length, end).trim();
  const sources: ParsedSource[] = [];

  for (const segment of block.split(/\n\n---\n\n/)) {
    const lines = segment.trim().split('\n');
    if (lines.length === 0) continue;
    const header = HEADER_PATTERN.exec(lines[0].trim());
    if (!header) continue;
    sources.push({
      ordinal: Number.parseInt(header[1], 10),
      header: header[2].trim(),
      content: lines.slice(1).join('\n').trim(),
    });
  }

  return { question, sources };
}

interface ScoredSentence {
  text: string;
  ordinal: number;
  score: number;
  position: number;
}

/** Inverse document frequency across the candidate sources only. */
function buildIdf(sources: ParsedSource[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const source of sources) {
    for (const term of new Set(tokenise(source.content))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  const total = Math.max(1, sources.length);
  for (const [term, frequency] of documentFrequency) {
    idf.set(term, Math.log(1 + total / frequency));
  }
  return idf;
}

const RELEVANCE_FLOOR = 0.18;

/**
 * A heading is a topic label, not a statement, so it must never be selected as
 * an answer sentence. Headings are recognised by the absence of terminating
 * punctuation combined with a short length — the same shape the chunker uses
 * when it derives section titles.
 */
function looksLikeHeading(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.length > 90) return false;
  if (/[.!?:;]$/.test(trimmed)) return false;
  // A real statement of this length almost always ends in punctuation.
  return trimmed.split(/\s+/).length <= 12;
}

export function composeExtractiveAnswer(question: string, sources: ParsedSource[]): string {
  if (sources.length === 0) {
    return `${UNSUPPORTED_ANSWER} No approved sources were retrieved for this question.`;
  }

  const questionTerms = new Set(
    tokenise(question).filter((term) => !STOPWORDS.has(term) && term.length >= 3),
  );
  if (questionTerms.size === 0) {
    return 'Could you rephrase that with a little more detail? I need something specific to search the approved sources for.';
  }

  const idf = buildIdf(sources);
  let totalWeight = 0;
  for (const term of questionTerms) totalWeight += idf.get(term) ?? 1;

  const candidates: ScoredSentence[] = [];

  for (const source of sources) {
    const sentences = splitSentences(source.content);
    sentences.forEach((sentence, index) => {
      const trimmed = sentence.trim();
      if (trimmed.length < 30 || trimmed.length > 600) return;
      if (looksLikeHeading(trimmed)) return;

      const sentenceTerms = new Set(tokenise(trimmed));
      let matched = 0;
      for (const term of questionTerms) {
        if (sentenceTerms.has(term)) matched += idf.get(term) ?? 1;
      }
      if (matched === 0) return;

      const coverage = totalWeight > 0 ? matched / totalWeight : 0;
      // Earlier sentences in a passage tend to carry the definitional statement.
      const positionBonus = Math.max(0, 0.12 - index * 0.02);
      // Higher-ranked sources get a modest edge so ties resolve toward the best
      // evidence rather than arbitrarily.
      const rankBonus = Math.max(0, 0.1 - (source.ordinal - 1) * 0.02);

      candidates.push({
        text: trimmed,
        ordinal: source.ordinal,
        score: coverage + positionBonus + rankBonus,
        position: index,
      });
    });
  }

  const relevant = candidates
    .filter((candidate) => candidate.score >= RELEVANCE_FLOOR)
    .sort((a, b) => b.score - a.score);

  if (relevant.length === 0) {
    const titles = [...new Set(sources.map((s) => s.header.split(' | ')[0]))].slice(0, 3);
    return `${UNSUPPORTED_ANSWER}\n\nThe closest approved material I found covers ${titles.join(', ')}, but none of it addresses this question directly. Rephrasing with a more specific term, or asking for a human review, would be the next step.`;
  }

  // Keep at most two sentences per source so one long passage cannot dominate.
  const perSourceCount = new Map<number, number>();
  const selected: ScoredSentence[] = [];
  for (const candidate of relevant) {
    const used = perSourceCount.get(candidate.ordinal) ?? 0;
    if (used >= 2) continue;
    if (selected.some((entry) => entry.text === candidate.text)) continue;
    perSourceCount.set(candidate.ordinal, used + 1);
    selected.push(candidate);
    if (selected.length >= 4) break;
  }

  // Present in source order, then document order: the result reads as a
  // coherent passage rather than a ranked list.
  selected.sort((a, b) =>
    a.ordinal !== b.ordinal ? a.ordinal - b.ordinal : a.position - b.position,
  );

  const body = selected
    .map((entry) => {
      const text = entry.text.replace(/\s+/g, ' ').trim();
      const punctuated = /[.!?]$/.test(text) ? text : `${text}.`;
      return `${punctuated} [${entry.ordinal}]`;
    })
    .join(' ');

  const coveredTerms = new Set<string>();
  for (const entry of selected) {
    for (const term of tokenise(entry.text)) coveredTerms.add(term);
  }
  const missing = [...questionTerms].filter((term) => !coveredTerms.has(term));

  if (missing.length > 0 && missing.length >= questionTerms.size / 2) {
    return `${body}\n\nThe approved sources do not cover every part of your question. I could not find material addressing: ${missing.slice(0, 5).join(', ')}.`;
  }

  return body;
}

export class DemoLlmProvider implements LlmProvider {
  readonly name = 'demo' as const;
  readonly model = 'atlas-extractive-demo-v1';
  readonly isDemo = true;

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const started = Date.now();
    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user');
    const { question, sources } = parsePromptSources(lastUser?.content ?? '');
    const text = composeExtractiveAnswer(question, sources);

    return {
      text,
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
      isDemo: true,
    };
  }

  async healthCheck(): Promise<LlmHealth> {
    return {
      status: 'demo',
      detail:
        'Deterministic extractive generator. No external service is contacted and no credentials are required. Answers are assembled from sentences found in the retrieved sources and are never paraphrased.',
      checkedAt: new Date().toISOString(),
    };
  }
}
