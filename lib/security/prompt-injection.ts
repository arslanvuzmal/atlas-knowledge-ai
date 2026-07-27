/**
 * Prompt-injection detection.
 *
 * This is a *signal*, not a control. The actual controls that keep injected
 * instructions harmless are architectural and live elsewhere:
 *
 *   1. Retrieved passages are wrapped in explicit untrusted-data delimiters and
 *      the system prompt states that their contents are data (lib/ai/prompt.ts).
 *   2. Access filtering happens in SQL against the caller's role, so no text in
 *      a document can widen what is retrievable (lib/retrieval/search.ts).
 *   3. The answer generator has no tools, no network egress, and no secret
 *      access, so "call this URL" or "print your environment" have nothing to
 *      act on.
 *
 * Detection exists so that suspicious content can be logged, surfaced to
 * administrators, and escalated to a human.
 */

export type InjectionCategory =
  | 'instruction_override'
  | 'system_prompt_extraction'
  | 'secret_extraction'
  | 'access_control_bypass'
  | 'tool_or_network_invocation'
  | 'data_exfiltration'
  | 'false_verification'
  | 'role_impersonation';

export type InjectionRisk = 'none' | 'low' | 'medium' | 'high';

export interface InjectionSignal {
  category: InjectionCategory;
  pattern: string;
  excerpt: string;
  weight: number;
}

export interface InjectionAssessment {
  detected: boolean;
  risk: InjectionRisk;
  score: number;
  signals: InjectionSignal[];
  categories: InjectionCategory[];
}

interface Rule {
  category: InjectionCategory;
  label: string;
  regex: RegExp;
  weight: number;
}

const RULES: Rule[] = [
  {
    category: 'instruction_override',
    label: 'ignore-previous-instructions',
    regex:
      /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(all\s+)?(previous|prior|earlier|above|preceding|system|original)\b[^.\n]{0,30}\b(instruction|prompt|rule|direction|message|context|guideline)s?\b/i,
    weight: 5,
  },
  {
    category: 'instruction_override',
    label: 'new-instructions-follow',
    regex:
      /\b(new|updated|revised)\s+(instructions?|rules?|system\s+prompt)\b[^.\n]{0,20}(follow|below|are|:)/i,
    weight: 4,
  },
  {
    category: 'system_prompt_extraction',
    label: 'reveal-system-prompt',
    regex:
      /\b(reveal|show|print|output|repeat|display|disclose|dump|tell\s+me)\b[^.\n]{0,40}\b(system|initial|hidden|internal|original)\s+(prompt|instruction|message|directive)s?\b/i,
    weight: 5,
  },
  {
    category: 'system_prompt_extraction',
    label: 'verbatim-above',
    regex: /\brepeat\b[^.\n]{0,30}\b(everything|all\s+text|the\s+words)\b[^.\n]{0,20}\babove\b/i,
    weight: 4,
  },
  {
    category: 'secret_extraction',
    label: 'environment-or-keys',
    regex:
      /\b(show|print|reveal|list|output|dump|expose|what\s+(is|are))\b[^.\n]{0,40}\b(environment\s+variables?|env\s+vars?|api[\s_-]?keys?|secrets?|credentials?|passwords?|connection\s+strings?|\.env)\b/i,
    weight: 5,
  },
  {
    category: 'secret_extraction',
    label: 'process-env',
    regex: /\bprocess\s*\.\s*env\b|\bDATABASE_URL\b|\bAUTH_SECRET\b|\bSERVICE_ROLE_KEY\b/i,
    weight: 4,
  },
  {
    category: 'access_control_bypass',
    label: 'disable-access-controls',
    regex:
      /\b(ignore|bypass|disable|skip|turn\s+off|circumvent|remove|drop)\b[^.\n]{0,40}\b(access[\s-]?control|permission|authorisation|authorization|security|role|restriction|access\s+filter|acl)s?\b/i,
    weight: 5,
  },
  {
    category: 'access_control_bypass',
    label: 'privilege-claim',
    regex:
      /\b(i\s+am|i'm|as)\s+(the\s+)?(an?\s+)?(admin(istrator)?|manager|superuser|root|owner|developer)\b[^.\n]{0,40}\b(so|therefore|now|please|give|show|grant)\b/i,
    weight: 3,
  },
  {
    category: 'access_control_bypass',
    label: 'restricted-document-fishing',
    regex:
      /\b(retrieve|fetch|access|show|give\s+me|read|reveal)\b[^.\n]{0,40}\b(restricted|confidential|internal[\s-]only|employee[\s-]only|manager[\s-]only|admin[\s-]only|classified|privileged)\b[^.\n]{0,25}\b(document|file|content|record|data|procedure|handbook)s?\b/i,
    weight: 4,
  },
  {
    category: 'tool_or_network_invocation',
    label: 'external-fetch',
    regex:
      /\b(fetch|curl|wget|request|call|post|send|http\s+get)\b[^.\n]{0,25}(https?:\/\/|\bthe\s+url\b|\ban?\s+external\s+(url|api|endpoint|server)\b)/i,
    weight: 5,
  },
  {
    category: 'tool_or_network_invocation',
    label: 'code-execution',
    regex:
      /\b(execute|run|eval(uate)?)\b[^.\n]{0,25}\b(this\s+)?(code|script|command|shell|sql|javascript|python)\b/i,
    weight: 4,
  },
  {
    category: 'data_exfiltration',
    label: 'dump-database',
    regex:
      /\b(return|list|dump|select|show|give\s+me)\b[^.\n]{0,30}\b(all|every)\b[^.\n]{0,30}\b(database\s+)?(record|row|user|document|table|customer|email\s+address)s?\b/i,
    weight: 4,
  },
  {
    category: 'data_exfiltration',
    label: 'sql-injection-shape',
    regex: /\b(drop\s+table|union\s+select|;\s*delete\s+from|or\s+1\s*=\s*1)\b/i,
    weight: 4,
  },
  {
    category: 'false_verification',
    label: 'assert-unverified',
    regex:
      /\b(mark|treat|label|consider|report)\b[^.\n]{0,30}\b(this|the\s+answer|it)\b[^.\n]{0,25}\bas\s+(verified|confirmed|accurate|correct|approved|certain)\b/i,
    weight: 5,
  },
  {
    category: 'false_verification',
    label: 'fabricate-source',
    regex:
      /\b(pretend|claim|say|state|act\s+as\s+if|make\s+it\s+look\s+like)\b[^.\n]{0,40}\b(the\s+)?(document|policy|manual|source|handbook|guide)\b[^.\n]{0,25}\b(says?|states?|guarantees?|allows?|permits?)\b/i,
    weight: 5,
  },
  {
    category: 'false_verification',
    label: 'invent-citation',
    regex:
      /\b(make\s+up|invent|fabricate|generate\s+a\s+fake)\b[^.\n]{0,30}\b(citation|source|reference|quote|page\s+number)s?\b/i,
    weight: 5,
  },
  {
    category: 'role_impersonation',
    label: 'system-turn-injection',
    regex:
      /(^|\n)\s*(system|assistant|developer)\s*[:>]\s*\S|<\|\s*(im_start|system|endoftext)\s*\|>|\[\/?INST\]/i,
    weight: 4,
  },
  {
    category: 'role_impersonation',
    label: 'jailbreak-persona',
    regex:
      /\b(you\s+are\s+now|from\s+now\s+on\s+you\s+are|act\s+as)\b[^.\n]{0,30}\b(dan|unrestricted|unfiltered|jailbroken|developer\s+mode|no\s+longer\s+bound)\b/i,
    weight: 4,
  },
];

/** Zero-width and word-joiner characters used to split trigger words. */
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;
/** C0/C1 control characters, excluding tab, newline and carriage return. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  return text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * Scans untrusted text. Scoring is additive across distinct rules, but a single
 * rule only counts once, so a document that repeats the same phrase fifty times
 * does not inflate the risk beyond what one occurrence warrants.
 */
export function detectPromptInjection(input: string): InjectionAssessment {
  if (!input || input.trim().length === 0) {
    return { detected: false, risk: 'none', score: 0, signals: [], categories: [] };
  }

  // Normalise obfuscation before matching, and cap the work done on any single
  // input so a very large document cannot become a CPU denial-of-service.
  const normalised = input
    .slice(0, 60_000)
    .replace(INVISIBLE_CHARS, '')
    .replace(/[_*~`]{1,3}/g, '');

  const signals: InjectionSignal[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    if (seen.has(rule.label)) continue;
    const match = rule.regex.exec(normalised);
    if (match) {
      seen.add(rule.label);
      signals.push({
        category: rule.category,
        pattern: rule.label,
        excerpt: excerptAround(normalised, match.index, match[0].length),
        weight: rule.weight,
      });
    }
  }

  const score = signals.reduce((total, signal) => total + signal.weight, 0);
  const categories = [...new Set(signals.map((s) => s.category))];

  let risk: InjectionRisk = 'none';
  if (score >= 9) risk = 'high';
  else if (score >= 5) risk = 'medium';
  else if (score > 0) risk = 'low';

  return { detected: signals.length > 0, risk, score, signals, categories };
}

/**
 * Neutralises delimiter forgery inside untrusted text before it is placed into
 * a prompt. Content is preserved (the model still needs to read it) but the
 * sequences that could close the untrusted block, or forge a new conversation
 * turn, are defanged.
 */
export function neutraliseUntrustedText(input: string): string {
  return input
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .replace(/<\|[^|>]{0,40}\|>/g, '[removed-control-token]')
    .replace(/\[\/?INST\]/gi, '[removed-control-token]')
    .replace(
      /<<<\s*(END|BEGIN)[_\s]?(UNTRUSTED|SOURCE|CONTEXT)[^>]{0,20}>>>/gi,
      '[removed-delimiter]',
    )
    .replace(/^\s*(system|assistant|developer)\s*:/gim, '$1 (quoted):');
}
