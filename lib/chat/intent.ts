import type { ConversationTurn } from '@/lib/retrieval/query';

export type ChatIntent =
  | 'GREETING'
  | 'HELP'
  | 'CAPABILITY'
  | 'THANKS'
  | 'FAREWELL'
  | 'SMALL_TALK'
  | 'CONVERSATIONAL'
  | 'KNOWLEDGE_QUERY'
  | 'FOLLOW_UP_KNOWLEDGE_QUERY'
  | 'HUMAN_REQUEST'
  | 'UNSAFE_OR_INJECTION';

export interface IntentResult {
  intent: ChatIntent;
  confidence: number;
  reasoning: string;
  isKnowledgeQuery: boolean;
  isConversational: boolean;
  shouldSkipRag: boolean;
}

const GREETING_PATTERNS = [
  /^hi\b/i,
  /^hello\b/i,
  /^hey\b/i,
  /^good\s+(morning|afternoon|evening)\b/i,
  /^howdy\b/i,
  /^hiya\b/i,
  /^what'?s\s+up\b/i,
  /^yo\b/i,
  /^greetings\b/i,
];

const HELP_PATTERNS = [
  /^help\b/i,
  /^can\s+you\s+help\b/i,
  /^i\s+need\s+(some\s+)?help\b/i,
  /^what\s+can\s+you\s+do\b/i,
  /^how\s+(do\s+i|to)\s+use\b/i,
  /^how\s+does\s+this\s+work\b/i,
  /^explain\s+how\s+to\b/i,
  /^i'?m\s+lost\b/i,
  /^getting\s+started\b/i,
];

const CAPABILITY_PATTERNS = [
  /^what\s+(can|are)\s+you\s+(capable\s+of|able\s+to\s+do)\b/i,
  /^what\s+are\s+your\s+(features|capabilities)\b/i,
  /^tell\s+me\s+what\s+you\s+can\s+do\b/i,
  /^what\s+do\s+you\s+know\b/i,
  /^what\s+questions\s+can\s+i\s+ask\b/i,
];

const THANKS_PATTERNS = [
  /^thanks\b/i,
  /^thank\s+you\b/i,
  /^thx\b/i,
  /^perfect\b/i,
  /^great\b/i,
  /^awesome\b/i,
  /^got\s+it\b/i,
  /^that\s+helps\b/i,
  /^appreciate\s+it\b/i,
];

const FAREWELL_PATTERNS = [
  /^bye\b/i,
  /^goodbye\b/i,
  /^see\s+you\b/i,
  /^farewell\b/i,
  /^later\b/i,
  /^cya\b/i,
  /^have\s+a\s+good\b/i,
];

const SMALL_TALK_PATTERNS = [
  /^how\s+are\s+you\b/i,
  /^what'?s\s+new\b/i,
  /^nice\s+(to\s+meet|talking)\b/i,
  /^tell\s+me\s+a\s+joke\b/i,
  /^who\s+are\s+you\b/i,
  /^what'?s\s+your\s+name\b/i,
];

const HUMAN_REQUEST_PATTERNS = [
  /^human\b/i,
  /^talk\s+to\s+a\s+(human|person|agent)\b/i,
  /^i\s+want\s+to\s+speak\s+to\s+(someone|a\s+human)\b/i,
  /^transfer\s+me\s+to\s+(a\s+human|support)\b/i,
  /^escalate\b/i,
  /^i\s+need\s+real\s+(help|support)\b/i,
];

function matchAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function isShortMessage(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length <= 5;
}

export function detectIntent(question: string, history: ConversationTurn[] = []): IntentResult {
  const normalized = normalize(question);

  if (matchAny(HUMAN_REQUEST_PATTERNS, normalized)) {
    return {
      intent: 'HUMAN_REQUEST',
      confidence: 0.95,
      reasoning: 'Explicit request for human operator',
      isKnowledgeQuery: false,
      isConversational: true,
      shouldSkipRag: true,
    };
  }

  if (matchAny(GREETING_PATTERNS, normalized)) {
    return {
      intent: 'GREETING',
      confidence: 0.95,
      reasoning: 'Greeting detected',
      isKnowledgeQuery: false,
      isConversational: true,
      shouldSkipRag: true,
    };
  }

  if (matchAny(HELP_PATTERNS, normalized)) {
    return {
      intent: 'HELP',
      confidence: 0.9,
      reasoning: 'Help request detected',
      isKnowledgeQuery: false,
      isConversational: true,
      shouldSkipRag: true,
    };
  }

  if (matchAny(CAPABILITY_PATTERNS, normalized)) {
    return {
      intent: 'CAPABILITY',
      confidence: 0.9,
      reasoning: 'Capability inquiry detected',
      isKnowledgeQuery: false,
      isConversational: true,
      shouldSkipRag: true,
    };
  }

  if (matchAny(THANKS_PATTERNS, normalized)) {
    return {
      intent: 'THANKS',
      confidence: 0.95,
      reasoning: 'Thank you detected',
      isKnowledgeQuery: false,
      isConversational: true,
      shouldSkipRag: true,
    };
  }

  if (matchAny(FAREWELL_PATTERNS, normalized)) {
    return {
      intent: 'FAREWELL',
      confidence: 0.95,
      reasoning: 'Farewell detected',
      isKnowledgeQuery: false,
      isConversational: true,
      shouldSkipRag: true,
    };
  }

  if (matchAny(SMALL_TALK_PATTERNS, normalized)) {
    return {
      intent: 'SMALL_TALK',
      confidence: 0.85,
      reasoning: 'Small talk detected',
      isKnowledgeQuery: false,
      isConversational: true,
      shouldSkipRag: true,
    };
  }

  const followUpResult = detectFollowUpIntent(normalized, history);
  if (followUpResult) {
    return followUpResult;
  }

  if (isShortMessage(normalized) && !hasKnowledgeKeywords(normalized)) {
    return {
      intent: 'CONVERSATIONAL',
      confidence: 0.7,
      reasoning: 'Short conversational message without knowledge keywords',
      isKnowledgeQuery: false,
      isConversational: true,
      shouldSkipRag: true,
    };
  }

  return {
    intent: 'KNOWLEDGE_QUERY',
    confidence: 0.8,
    reasoning: 'Knowledge query detected',
    isKnowledgeQuery: true,
    isConversational: false,
    shouldSkipRag: false,
  };
}

function detectFollowUpIntent(
  normalized: string,
  history: ConversationTurn[],
): IntentResult | null {
  if (history.length === 0) return null;

  const recentUserTurns = history.filter((t) => t.role === 'USER').slice(-3);

  if (recentUserTurns.length === 0) return null;

  const lastUserQuestion = recentUserTurns[recentUserTurns.length - 1].content.toLowerCase();
  const wasKnowledgeQuery = hasKnowledgeKeywords(lastUserQuestion);

  if (!wasKnowledgeQuery) return null;

  const followUpOpeners = [
    /^(and|but|so|also|then|therefore)\b/i,
    /^what\s+about\b/i,
    /^how\s+about\b/i,
    /^does\s+that\b/i,
    /^does\s+this\b/i,
    /^what\s+if\b/i,
    /^can\s+you\s+elaborate\b/i,
    /^tell\s+me\s+more\b/i,
    /^why\b/i,
    /^when\b/i,
    /^where\b/i,
    /^who\b/i,
  ];

  if (followUpOpeners.some((p) => p.test(normalized))) {
    return {
      intent: 'FOLLOW_UP_KNOWLEDGE_QUERY',
      confidence: 0.85,
      reasoning: 'Follow-up to previous knowledge query',
      isKnowledgeQuery: true,
      isConversational: false,
      shouldSkipRag: false,
    };
  }

  if (isShortMessage(normalized) && hasReferentialMarkers(normalized)) {
    return {
      intent: 'FOLLOW_UP_KNOWLEDGE_QUERY',
      confidence: 0.75,
      reasoning: 'Short follow-up with referential markers',
      isKnowledgeQuery: true,
      isConversational: false,
      shouldSkipRag: false,
    };
  }

  return null;
}

function hasKnowledgeKeywords(text: string): boolean {
  const knowledgeKeywords = [
    'what',
    'how',
    'when',
    'where',
    'who',
    'why',
    'policy',
    'refund',
    'price',
    'cost',
    'plan',
    'subscription',
    'encryption',
    'security',
    'compliance',
    'hipaa',
    'data',
    'leave',
    'vacation',
    'benefit',
    'salary',
    'pay',
    'incident',
    'sev',
    'commander',
    'oncall',
    'escalation',
    'trial',
    'credit',
    'card',
    'billing',
    'invoice',
    'mobile',
    'app',
    'api',
    'integration',
    'flow',
    'step',
    'run',
    'audit',
    'retention',
    'gdpr',
    'employee',
    'manager',
    'customer',
    'public',
    'access',
    'document',
    'source',
    'citation',
    'evidence',
  ];

  return knowledgeKeywords.some((kw) => text.includes(kw));
}

function hasReferentialMarkers(text: string): boolean {
  const markers = new Set([
    'that',
    'this',
    'those',
    'these',
    'it',
    'they',
    'them',
    'such',
    'same',
    'similar',
    'also',
    'too',
    'either',
    'apply',
    'work',
    'cover',
    'include',
    'exclude',
  ]);

  const words = text.split(/\s+/);
  return words.some((w) => markers.has(w.toLowerCase()));
}

export function getConversationalResponse(intent: ChatIntent): string {
  switch (intent) {
    case 'GREETING':
      return 'Hi! How can I help you today?';
    case 'HELP':
      return "Of course! Tell me what you need help with, and I'll either answer from the approved knowledge base or point you in the right direction.";
    case 'CAPABILITY':
      return 'I can search your approved organizational knowledge, answer questions with source citations, respect access permissions, refuse unsupported claims, and escalate to a human when needed. What would you like to know?';
    case 'THANKS':
      return "You're welcome! What else can I help with?";
    case 'FAREWELL':
      return 'Goodbye! Feel free to return if you have more questions.';
    case 'SMALL_TALK':
      return "I'm doing well, thank you! How can I assist you today?";
    case 'CONVERSATIONAL':
      return "I'm here to help with questions about your approved knowledge base. What would you like to know?";
    case 'HUMAN_REQUEST':
      return "I'll connect you with a human operator. They'll be able to help you further.";
    default:
      return 'How can I help you?';
  }
}
