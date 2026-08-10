export interface FastRouteResult {
  isConversational: boolean;
  replyText?: string;
  intent: 'CONVERSATIONAL' | 'KNOWLEDGE_QUERY';
}

const SOCIAL_ONLY_PATTERNS = [
  /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy|yo)[.!]?$/i,
  /^(thanks|thank you|thx|cheers|thanks a lot)[.!]?$/i,
  /^(bye|goodbye|see ya|talk to you later)[.!]?$/i,
  /^(can you help|can you help me|i need some help|help me)[.!]?$/i,
  /^(what can you do|what are your capabilities|who are you)[.!]?$/i,
];

const KNOWLEDGE_KEYWORDS = [
  'price',
  'pricing',
  'cost',
  'refund',
  'policy',
  'security',
  'soc2',
  'saml',
  'sso',
  'sla',
  'support',
  'plan',
  'team',
  'annual',
  'monthly',
  'trial',
  'handbook',
  'incident',
  'data',
  'encryption',
  'hipaa',
  'gdpr',
  'seat',
  'license',
  'feature',
];

/**
 * Deterministic Tier 0 Fast Chat Router (~100ms response for purely conversational messages).
 * Ensures factual queries (even with social prefixes like "Hi, what is your refund policy?")
 * route directly to governed RAG.
 */
export function routeFastChat(question: string): FastRouteResult {
  const trimmed = question.trim();
  const lower = trimmed.toLowerCase();

  // If question contains any knowledge domain keywords, route immediately to RAG
  const hasKnowledgeKeyword = KNOWLEDGE_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasKnowledgeKeyword) {
    return { isConversational: false, intent: 'KNOWLEDGE_QUERY' };
  }

  // Check pure conversational patterns
  const isSocialMatch = SOCIAL_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));

  if (isSocialMatch) {
    let replyText = "Hello! I'm Atlas, your governed Customer Intelligence Assistant. How can I help you today?";
    if (lower.includes('thanks') || lower.includes('thank')) {
      replyText = "You're very welcome! Let me know if you have any other questions about our platform or policies.";
    } else if (lower.includes('bye') || lower.includes('goodbye')) {
      replyText = "Goodbye! Have a great day ahead.";
    } else if (lower.includes('what can you do') || lower.includes('capabilities')) {
      replyText = "I can answer questions grounded in approved business policies, pricing, and security documentation, capture customer requirements, and connect you with our sales or support team.";
    }

    return {
      isConversational: true,
      replyText,
      intent: 'CONVERSATIONAL',
    };
  }

  return { isConversational: false, intent: 'KNOWLEDGE_QUERY' };
}
