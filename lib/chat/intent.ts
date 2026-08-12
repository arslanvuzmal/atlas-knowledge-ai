import type { ConversationTurn } from '@/lib/retrieval/query';
import { detectPromptInjection } from '@/lib/security/prompt-injection';

export type ChatRoute =
  | 'LOCAL_CONVERSATION'
  | 'GENERAL_KNOWLEDGE'
  | 'LIVE_EXTERNAL'
  | 'ORGANIZATIONAL_KNOWLEDGE'
  | 'FOLLOW_UP_ORGANIZATIONAL'
  | 'HUMAN_REQUEST'
  | 'UNSAFE'
  | 'AMBIGUOUS';

export interface RouteResult {
  route: ChatRoute;
  confidence: number;
  reason: string;
  requiresRag: boolean;
  requiresGemini: boolean;
  requiresLiveTool: boolean;
  requiresHistory: boolean;
  cleanQuestion: string;
  missingLocation?: boolean;
}

// Backward-compatible ChatIntent mapping
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
  routeResult: RouteResult;
}

const GREETING_PREFIX_REGEX =
  /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|hiya|what'?s\s+up|yo|greetings)\b[\s,!]*(\b(there|everyone|friend|atlas)\b[\s,!]*)*\s*/i;

const THANKS_PREFIX_REGEX = /^(thanks|thank\s+you|thx|appreciate\s+it)\b[\s,!]*/i;

const HUMAN_REQUEST_PATTERNS = [
  /\bhuman\b/i,
  /\btalk\s+to\s+a\s+(human|person|agent)\b/i,
  /\bi\s+want\s+to\s+speak\s+to\s+(someone|a\s+human)\b/i,
  /\btransfer\s+me\s+to\s+(a\s+human|support)\b/i,
  /\bescalate\b/i,
  /\bcan\s+someone\s+contact\s+me\b/i,
  /\bhave\s+someone\s+follow\s+up\b/i,
  /\bcontact\s+me\b/i,
];

const WEATHER_PATTERNS = [
  /\bweather\b/i,
  /\btemperature\b/i,
  /\bforecast\b/i,
  /\bwill\s+it\s+rain\b/i,
  /\bis\s+it\s+raining\b/i,
  /\bsnowing\b/i,
  /\bwind\s+speed\b/i,
];

const LIVE_EXTERNAL_PATTERNS = [
  /\b(today|currently|right\s+now|latest|news|version|exchange\s+rate|stock\s+price|current\s+ceo|current\s+president|time\s+in)\b/i,
  /\bwhat\s+time\s+is\s+it\b/i,
  /\blatest\s+ai\s+news\b/i,
  /\bwho\s+won\s+yesterday\b/i,
  /\bcurrent\s+usd\b/i,
];

const UNSAFE_PATTERNS = [
  /\b(ignore|override|bypass|disregard)\b.*\b(authorization|permission|access|security|manager|role|instruction)s?\b/i,
  /\b(set|grant|make)\b.*\b(admin|manager|superuser|root)\b/i,
  /\bshow\s+manager\s+docs\b/i,
];

const STRICT_ORGANIZATIONAL_PATTERNS = [
  /\b(our|we|northstar|atlas)\b/i,
  /\b(refund\s+policy|refund\s+window|employee\s+handbook|handbook|team\s+plan|starter\s+plan|enterprise\s+plan|support\s+faq|support\s+response|incident\s+response|security\s+overview|sales\s+enablement|product\s+manual)\b/i,
  /\b(refund|refunds|pricing|subscription|trial|free\s+trial|sla|on-call|oncall)\b/i,
  /\b(do\s+you|can\s+you|does\s+atlas|does\s+northstar|what\s+services|what\s+products|insurance)\b/i,
  /\bencryption\s+is\s+used\b/i,
  /\bdata\s+at\s+rest\b/i,
];

const AMBIGUOUS_REFERENTIAL_PATTERNS = [
  /^(does|will|can)\s+(that|this|it)\b/i,
  /^what\s+about\s+(that|this|it)\b/i,
  /^how\s+about\s+(that|this|it)\b/i,
  /^and\s+for\s+(that|this|it)\b/i,
  /^apply\s+to\s+(that|this|it)\b/i,
];

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

export function stripSocialPrefix(raw: string): string {
  let text = raw.trim();
  text = text.replace(GREETING_PREFIX_REGEX, '');
  text = text.replace(THANKS_PREFIX_REGEX, '');
  return text.trim();
}

export function routeMessage(question: string, history: ConversationTurn[] = []): RouteResult {
  const rawNormalized = normalize(question);
  const cleanQuestion = stripSocialPrefix(question);
  const cleanNormalized = normalize(cleanQuestion);

  // 1. Security / Prompt Injection Override Check -> UNSAFE Route
  const injection = detectPromptInjection(question);
  const matchesUnsafePattern = UNSAFE_PATTERNS.some((p) => p.test(cleanNormalized));

  if (
    matchesUnsafePattern ||
    (injection.risk === 'high' && injection.signals.some((s) => s.weight >= 0.8))
  ) {
    return {
      route: 'UNSAFE',
      confidence: 0.99,
      reason: 'High-risk security instruction override detected',
      requiresRag: false,
      requiresGemini: false,
      requiresLiveTool: false,
      requiresHistory: false,
      cleanQuestion,
    };
  }

  // 2. Human Operator / Escalation Request
  if (HUMAN_REQUEST_PATTERNS.some((p) => p.test(rawNormalized))) {
    return {
      route: 'HUMAN_REQUEST',
      confidence: 0.95,
      reason: 'Explicit request for human operator or CRM follow-up',
      requiresRag: false,
      requiresGemini: false,
      requiresLiveTool: false,
      requiresHistory: false,
      cleanQuestion,
    };
  }

  // 3. Social / Local Fast Path
  if (cleanNormalized.length === 0) {
    return {
      route: 'LOCAL_CONVERSATION',
      confidence: 0.98,
      reason: 'Pure greeting or social expression',
      requiresRag: false,
      requiresGemini: false,
      requiresLiveTool: false,
      requiresHistory: false,
      cleanQuestion: '',
    };
  }

  const isSmallTalkOnly = [
    /^how\s+are\s+you\b/i,
    /^what\s+can\s+you\s+do\b/i,
    /^who\s+are\s+you\b/i,
    /^tell\s+me\s+a\s+joke\b/i,
    /^goodbye\b/i,
    /^bye\b/i,
    /^there\b/i,
  ].some((p) => p.test(cleanNormalized));

  if (isSmallTalkOnly && cleanNormalized.split(/\s+/).length <= 6) {
    return {
      route: 'LOCAL_CONVERSATION',
      confidence: 0.95,
      reason: 'Trivial small talk or system capability query',
      requiresRag: false,
      requiresGemini: false,
      requiresLiveTool: false,
      requiresHistory: false,
      cleanQuestion,
    };
  }

  // 4. Ambiguous Context-Less Referential Check
  if (history.length === 0 && AMBIGUOUS_REFERENTIAL_PATTERNS.some((p) => p.test(cleanNormalized))) {
    return {
      route: 'AMBIGUOUS',
      confidence: 0.9,
      reason: 'Referential request with insufficient conversation history',
      requiresRag: false,
      requiresGemini: false,
      requiresLiveTool: false,
      requiresHistory: true,
      cleanQuestion,
    };
  }

  // 5. Follow-up Check to previous organizational query
  if (history.length > 0) {
    const recentUserTurns = history.filter((t) => t.role === 'USER').slice(-2);
    if (recentUserTurns.length > 0) {
      const lastQuestion = recentUserTurns[recentUserTurns.length - 1].content.toLowerCase();
      const lastWasOrg = STRICT_ORGANIZATIONAL_PATTERNS.some((p) => p.test(lastQuestion));
      const isReferentialFollowUp = AMBIGUOUS_REFERENTIAL_PATTERNS.some((p) =>
        p.test(cleanNormalized),
      );

      if (lastWasOrg && isReferentialFollowUp) {
        return {
          route: 'FOLLOW_UP_ORGANIZATIONAL',
          confidence: 0.9,
          reason: 'Follow-up to previous organizational knowledge query',
          requiresRag: true,
          requiresGemini: true,
          requiresLiveTool: false,
          requiresHistory: true,
          cleanQuestion,
        };
      }
    }
  }

  // 6. Weather / Live External Information Check BEFORE Org Check
  const isWeather = WEATHER_PATTERNS.some((p) => p.test(cleanNormalized));
  if (isWeather) {
    const hasLocation =
      /\b(in|at|for|near)\s+([A-Z][a-z]+|[a-z]+)\b/i.test(cleanNormalized) ||
      /\b(budapest|london|tokyo|islamabad|paris|new york|san francisco|berlin|sydney)\b/i.test(
        cleanNormalized,
      );

    return {
      route: 'LIVE_EXTERNAL',
      confidence: 0.95,
      reason: 'Live weather query',
      requiresRag: false,
      requiresGemini: hasLocation,
      requiresLiveTool: hasLocation,
      requiresHistory: false,
      cleanQuestion,
      missingLocation: !hasLocation,
    };
  }

  const isLiveInfo = LIVE_EXTERNAL_PATTERNS.some((p) => p.test(cleanNormalized));
  if (isLiveInfo) {
    return {
      route: 'LIVE_EXTERNAL',
      confidence: 0.9,
      reason: 'Live external information query',
      requiresRag: false,
      requiresGemini: true,
      requiresLiveTool: true,
      requiresHistory: false,
      cleanQuestion,
    };
  }

  // 7. Explicit Organizational RAG Query Check
  const hasStrictOrgSignal = STRICT_ORGANIZATIONAL_PATTERNS.some((p) => p.test(cleanNormalized));

  if (hasStrictOrgSignal) {
    return {
      route: 'ORGANIZATIONAL_KNOWLEDGE',
      confidence: 0.92,
      reason: 'Contains explicit organizational or policy reference',
      requiresRag: true,
      requiresGemini: true,
      requiresLiveTool: false,
      requiresHistory: false,
      cleanQuestion,
    };
  }

  // 8. Safe Default -> GENERAL_KNOWLEDGE
  return {
    route: 'GENERAL_KNOWLEDGE',
    confidence: 0.85,
    reason: 'Unclassified question defaulting to general world knowledge',
    requiresRag: false,
    requiresGemini: true,
    requiresLiveTool: false,
    requiresHistory: false,
    cleanQuestion,
  };
}

export function detectIntent(question: string, history: ConversationTurn[] = []): IntentResult {
  const routeRes = routeMessage(question, history);

  let intent: ChatIntent = 'KNOWLEDGE_QUERY';
  if (routeRes.route === 'LOCAL_CONVERSATION') {
    intent = 'GREETING';
  } else if (routeRes.route === 'HUMAN_REQUEST') {
    intent = 'HUMAN_REQUEST';
  } else if (routeRes.route === 'FOLLOW_UP_ORGANIZATIONAL') {
    intent = 'FOLLOW_UP_KNOWLEDGE_QUERY';
  } else if (routeRes.route === 'UNSAFE') {
    intent = 'UNSAFE_OR_INJECTION';
  }

  return {
    intent,
    confidence: routeRes.confidence,
    reasoning: routeRes.reason,
    isKnowledgeQuery: routeRes.requiresRag,
    isConversational:
      routeRes.route === 'LOCAL_CONVERSATION' || routeRes.route === 'GENERAL_KNOWLEDGE',
    shouldSkipRag: !routeRes.requiresRag,
    routeResult: routeRes,
  };
}

export function getConversationalResponse(intent: ChatIntent | ChatRoute): string {
  switch (intent) {
    case 'GREETING':
    case 'LOCAL_CONVERSATION':
      return 'Hi! How can I help you today?';
    case 'HELP':
      return "Of course! Tell me what you need help with, and I'll either answer from the approved knowledge base or point you in the right direction.";
    case 'CAPABILITY':
      return 'I can search your approved organizational knowledge, answer questions with source citations, handle general inquiries, retrieve live weather or web information, and escalate to a human when needed. What would you like to know?';
    case 'THANKS':
      return "You're welcome! What else can I help with?";
    case 'FAREWELL':
      return 'Goodbye! Feel free to return if you have more questions.';
    case 'SMALL_TALK':
      return "I'm doing well, thank you! How can I assist you today?";
    case 'HUMAN_REQUEST':
      return "I'll connect you with a human operator. Someone will follow up with you shortly.";
    case 'AMBIGUOUS':
      return "Could you clarify what you're referring to?";
    case 'UNSAFE':
      return 'I cannot comply with system prompt extraction or security override instructions.';
    default:
      return 'Hi! How can I help you today?';
  }
}
