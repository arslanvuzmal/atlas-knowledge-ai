export type Grounding = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';

export interface EvidencePacket {
  confidenceLabel: 'Strong evidence' | 'Partial evidence' | 'Insufficient evidence';
  supportingPassages: number;
  supportingDocuments: number;
  coverage: number;
  conflictDetected: boolean;
  conflictingDocuments: { documentId: string; title: string; excerpt: string }[];
}

export interface Citation {
  ordinal: number;
  documentId: string;
  documentTitle: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  excerpt: string;
  relevanceScore: number;
}

export interface RelatedSource {
  documentId: string;
  title: string;
  sectionTitle: string | null;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  grounding?: Grounding;
  confidence?: number;
  citations?: Citation[];
  relatedSources?: RelatedSource[];
  escalationId?: string | null;
  provider?: string;
  model?: string;
  isDemo?: boolean;
  /** Set when the request itself failed rather than the answer being unsupported. */
  errored?: boolean;
  createdAt: string;
  evidence?: EvidencePacket;
  pipelineMeta?: PipelineMetadata;
}

export interface PipelineMetadata {
  accessLevels: string[];
  retrieval: {
    vectorCandidates: number;
    keywordCandidates: number;
    fusedCandidates: number;
    afterAccessFilter: number;
    rerankedCount: number;
    hybrid: boolean;
    droppedByPostFilter: number;
    latencyMs: number;
  };
  confidence: {
    value: number;
    label: string;
    topScore: number;
    coverage: number;
    agreement: number;
    margin: number;
    supportingChunks: number;
    uncoveredTerms: string[];
  };
  grounding: Grounding;
  answer: {
    provider: string;
    model: string;
    latencyMs: number;
    isDemo: boolean;
    citationCount: number;
    invalidCitationMarkers: number[];
    usedFallbackCitations: boolean;
  };
  traceId: string;
  injectionFlagged: boolean;
  escalationId: string | null;
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  grounding: Grounding;
  confidence: number;
  citations: Citation[];
  relatedSources: RelatedSource[];
  evidence: EvidencePacket;
  provider: string;
  model: string;
  isDemo: boolean;
  escalationId: string | null;
  injectionFlagged: boolean;
  traceId: string;
  pipelineMeta?: PipelineMetadata;
}

export const GROUNDING_META: Record<
  Grounding,
  { label: string; tone: 'good' | 'warning' | 'critical'; description: string }
> = {
  SUPPORTED: {
    label: 'Supported',
    tone: 'good',
    description: 'Grounded in the cited approved sources.',
  },
  PARTIALLY_SUPPORTED: {
    label: 'Partially supported',
    tone: 'warning',
    description: 'Partly covered by the sources. Some of the question is not addressed.',
  },
  UNSUPPORTED: {
    label: 'Not supported',
    tone: 'critical',
    description: 'The approved knowledge base does not contain a reliable answer.',
  },
};
