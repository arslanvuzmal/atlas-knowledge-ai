import type {
  AccessLevel,
  DocumentStatus,
  EscalationPriority,
  EscalationStatus,
  FeedbackRating,
  GroundingLevel,
} from '@prisma/client';
import { Badge } from '@/components/ui/primitives';
import { ACCESS_LEVEL_LABELS } from '@/lib/auth/rbac';

type Tone = 'neutral' | 'accent' | 'iris' | 'good' | 'warning' | 'critical';

const DOCUMENT_STATUS: Record<DocumentStatus, { tone: Tone; label: string }> = {
  UPLOADED: { tone: 'neutral', label: 'Uploaded' },
  VALIDATING: { tone: 'accent', label: 'Validating' },
  EXTRACTING: { tone: 'accent', label: 'Extracting' },
  CHUNKING: { tone: 'accent', label: 'Chunking' },
  EMBEDDING: { tone: 'accent', label: 'Embedding' },
  INDEXED: { tone: 'good', label: 'Indexed' },
  FAILED: { tone: 'critical', label: 'Failed' },
  ARCHIVED: { tone: 'neutral', label: 'Archived' },
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const meta = DOCUMENT_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

// Restricted levels are visually distinct so an operator scanning a long list
// can see at a glance which sources are sensitive.
const ACCESS_TONE: Record<AccessLevel, Tone> = {
  PUBLIC: 'neutral',
  CUSTOMER: 'accent',
  EMPLOYEE: 'iris',
  MANAGER: 'warning',
  ADMIN: 'critical',
};

export function AccessLevelBadge({ level }: { level: AccessLevel }) {
  return <Badge tone={ACCESS_TONE[level]}>{ACCESS_LEVEL_LABELS[level]}</Badge>;
}

const GROUNDING: Record<GroundingLevel, { tone: Tone; label: string }> = {
  SUPPORTED: { tone: 'good', label: 'Supported' },
  PARTIALLY_SUPPORTED: { tone: 'warning', label: 'Partial' },
  UNSUPPORTED: { tone: 'critical', label: 'Unsupported' },
};

export function GroundingBadge({ level }: { level: GroundingLevel | null }) {
  if (!level) return <span className="text-xs text-ink-faint">—</span>;
  const meta = GROUNDING[level];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const ESCALATION_STATUS: Record<EscalationStatus, { tone: Tone; label: string }> = {
  OPEN: { tone: 'critical', label: 'Open' },
  ASSIGNED: { tone: 'warning', label: 'Assigned' },
  IN_PROGRESS: { tone: 'accent', label: 'In progress' },
  RESOLVED: { tone: 'good', label: 'Resolved' },
  CLOSED: { tone: 'neutral', label: 'Closed' },
};

export function EscalationStatusBadge({ status }: { status: EscalationStatus }) {
  const meta = ESCALATION_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const PRIORITY: Record<EscalationPriority, { tone: Tone; label: string }> = {
  LOW: { tone: 'neutral', label: 'Low' },
  NORMAL: { tone: 'accent', label: 'Normal' },
  HIGH: { tone: 'warning', label: 'High' },
  URGENT: { tone: 'critical', label: 'Urgent' },
};

export function PriorityBadge({ priority }: { priority: EscalationPriority }) {
  const meta = PRIORITY[priority];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const RATING: Record<FeedbackRating, { tone: Tone; label: string }> = {
  HELPFUL: { tone: 'good', label: 'Helpful' },
  PARTIALLY_HELPFUL: { tone: 'warning', label: 'Partly helpful' },
  NOT_HELPFUL: { tone: 'critical', label: 'Not helpful' },
};

export function RatingBadge({ rating }: { rating: FeedbackRating }) {
  const meta = RATING[rating];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function HealthBadge({ state }: { state: string }) {
  const tone: Record<string, Tone> = {
    OPERATIONAL: 'good',
    DEMO: 'iris',
    DEGRADED: 'warning',
    MISCONFIGURED: 'warning',
    UNAVAILABLE: 'critical',
  };
  const label = state.charAt(0) + state.slice(1).toLowerCase();
  return <Badge tone={tone[state] ?? 'neutral'}>{label}</Badge>;
}
