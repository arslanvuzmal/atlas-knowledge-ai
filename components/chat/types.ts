export type Grounding = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';

export interface EvidencePacket {
  confidenceLabel:
    'Strong evidence' | 'Partial evidence' | 'Insufficient evidence' | 'N/A' | 'Current Web Data';
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
  accessLevel?: string;
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
  sourceType?: 'APPROVED_KNOWLEDGE' | 'EXTERNAL_LIVE' | 'GENERAL_MODEL' | 'LOCAL';
  route?: string;
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
    margin?: number;
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
  traceId?: string;
  injectionFlagged?: boolean;
  escalationId?: string | null;
}

export interface GroundingMeta {
  label: string;
  tone: 'teal' | 'amber' | 'crimson';
  description: string;
}

export const GROUNDING_META: Record<Grounding, GroundingMeta> = {
  SUPPORTED: {
    label: 'SUPPORTED',
    tone: 'teal',
    description: 'Every statement in this answer is directly backed by an approved source.',
  },
  PARTIALLY_SUPPORTED: {
    label: 'PARTIALLY SUPPORTED',
    tone: 'amber',
    description:
      'The answer draws on approved sources, but some statements could not be cross-referenced.',
  },
  UNSUPPORTED: {
    label: 'UNSUPPORTED',
    tone: 'crimson',
    description: 'Retrieval did not produce enough approved evidence to answer this question.',
  },
};
