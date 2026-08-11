import type { ConversationTurn } from '@/lib/retrieval/query';

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

const ORGANIZATIONAL_KEYWORDS = [
  'policy',
  'refund',
  'pricing',
  'price',
  'cost',
  'plan',
  'team plan',
  'enterprise plan',
  'subscription',
  'annual',
  'monthly',
  'leave',
  'vacation',
  'soc 2',
  'hipaa',
  'security controls',
  'security',
  'encryption',
  'data at rest',
  'data in transit',
  'aes-256',
  'tls 1.3',
  'incident',
  'sev 1',
  'sev 2',
  'handbook',
  'northstar',
  'atlas',
  'compliance',
  'on-call',
  'oncall',
  'document',
  'auth',
  'authentication',
  'authorization',
  'sso',
  'saml',
  'mfa',
  '2fa',
  'audit',
  'backup',
  'retention',
  'sla',
  'uptime',
  'availability',
  'our company',
  'our product',
  'our security',
  'our pricing',
  'our refund',
  'our leave',
];

const GENERAL_KNOWLEDGE_PATTERNS = [
  /^what\s+is\s+(machine\s+learning|photosynthesis|compound\s+interest|ai|quantum\s+computing|blockchain|dna|gravity|black\s+hole|inflation)\b/i,
  /^who\s+(invented|created|wrote|discovered)\s+(python|javascript|linux|the\s+telephone|penicillin|relativity)\b/i,
  /^explain\s+(compound\s+interest|newton'?s|photosynthesis|machine\s+learning|relativity|quantum)\b/i,
  /^what\s+is\s+the\s+capital\s+of\b/i,
  /^give\s+me\s+\d+\s+ideas\b/i,
  /^how\s+does\s+(photosynthesis|gravity|a\s+car\s+engine)\s+work\b/i,
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

  // 1. Human Operator / Escalation Request
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

  // 2. Social / Local Fast Path
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

  // 3. Organizational RAG Query Check
  const hasOrgKeyword = ORGANIZATIONAL_KEYWORDS.some((kw) => cleanNormalized.includes(kw));

  // 4. Follow-up Check
  if (history.length > 0) {
    const recentTurns = history.filter((t) => t.role === 'USER').slice(-2);
    if (recentTurns.length > 0) {
      const lastQuestion = recentTurns[recentTurns.length - 1].content.toLowerCase();
      const lastWasOrg = ORGANIZATIONAL_KEYWORDS.some((kw) => lastQuestion.includes(kw));

      const isReferentialFollowUp = [
        /^does\s+(that|this)\b/i,
        /^what\s+about\b/i,
        /^how\s+about\b/i,
        /^and\s+for\b/i,
        /^apply\s+to\b/i,
      ].some((p) => p.test(cleanNormalized));

      if (lastWasOrg && (isReferentialFollowUp || (cleanNormalized.length < 35 && hasOrgKeyword))) {
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

  if (hasOrgKeyword) {
    return {
      route: 'ORGANIZATIONAL_KNOWLEDGE',
      confidence: 0.92,
      reason: 'Contains governed organizational keyword or policy reference',
      requiresRag: true,
      requiresGemini: true,
      requiresLiveTool: false,
      requiresHistory: false,
      cleanQuestion,
    };
  }

  // 5. Weather / Live External Information
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
      reason: isWeather ? 'Live weather query' : 'Live external information query',
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

  // 6. General Knowledge Query
  const isGeneralKnowledge =
    GENERAL_KNOWLEDGE_PATTERNS.some((p) => p.test(cleanNormalized)) ||
    (!hasOrgKeyword &&
      /^(what|who|why|where|how|explain)\b/i.test(cleanNormalized) &&
      !/\b(our|company|workspace|handbook|policy|pricing)\b/i.test(cleanNormalized));

  if (isGeneralKnowledge) {
    return {
      route: 'GENERAL_KNOWLEDGE',
      confidence: 0.88,
      reason: 'General stable world knowledge query',
      requiresRag: false,
      requiresGemini: true,
      requiresLiveTool: false,
      requiresHistory: false,
      cleanQuestion,
    };
  }

  // 7. Default Fallback -> Governed RAG
  return {
    route: 'ORGANIZATIONAL_KNOWLEDGE',
    confidence: 0.8,
    reason: 'Defaulting unclassified business query to governed RAG',
    requiresRag: true,
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
    default:
      return 'Hi! How can I help you today?';
  }
}
