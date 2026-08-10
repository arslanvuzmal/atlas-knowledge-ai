import { prisma } from '@/lib/database/client';
import type { ProvenanceSource } from '@prisma/client';

export interface ScoreFactor {
  category: 'FIT' | 'INTENT' | 'ENGAGEMENT' | 'TIMING' | 'COMMERCIAL_SIGNAL' | 'CONTACTABILITY';
  factor: string;
  points: number;
  provenance: ProvenanceSource;
  evidence?: string;
}

export interface LeadScoreResult {
  score: number;
  tier: string;
  factors: ScoreFactor[];
  calculatedAt: Date;
}

/**
 * Computes an explainable, rule-based lead score.
 * Every factor corresponds strictly to factual, non-sensitive business data.
 */
export async function calculateLeadScore(
  workspaceId: string,
  contactId: string,
): Promise<LeadScoreResult> {
  const contact = await prisma.contact.findFirst({
    where: { workspaceId, id: contactId },
    include: {
      intelligence: true,
      company: true,
      conversations: { select: { id: true, createdAt: true } },
    },
  });

  if (!contact) {
    return {
      score: 0,
      tier: 'Unqualified',
      factors: [],
      calculatedAt: new Date(),
    };
  }

  const factors: ScoreFactor[] = [];
  const intel = contact.intelligence;

  // 1. Contactability
  if (contact.primaryEmail && !contact.primaryEmail.endsWith('.demo')) {
    const isBusinessEmail = !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'].some((d) =>
      contact.primaryEmail?.endsWith(d),
    );
    if (isBusinessEmail) {
      factors.push({
        category: 'CONTACTABILITY',
        factor: 'Verified business email provided',
        points: 15,
        provenance: 'PROVIDED',
        evidence: contact.primaryEmail,
      });
    } else {
      factors.push({
        category: 'CONTACTABILITY',
        factor: 'Contact email provided',
        points: 8,
        provenance: 'PROVIDED',
        evidence: contact.primaryEmail,
      });
    }
  }

  if (contact.phone) {
    factors.push({
      category: 'CONTACTABILITY',
      factor: 'Direct phone number provided',
      points: 10,
      provenance: 'PROVIDED',
      evidence: contact.phone,
    });
  }

  // 2. Intent & Product Interest
  if (intel?.primaryIntent?.toLowerCase().includes('evaluat') || intel?.productInterest) {
    factors.push({
      category: 'INTENT',
      factor: `${intel.productInterest || 'Product'} evaluation`,
      points: 20,
      provenance: 'DERIVED',
      evidence: intel.summary ?? undefined,
    });
  }

  if (intel?.requestedFollowUp) {
    factors.push({
      category: 'INTENT',
      factor: 'Explicitly requested sales follow-up',
      points: 15,
      provenance: 'PROVIDED',
    });
  }

  // 3. Commercial Signal & Seat Requirement
  if (intel?.seatRequirement && intel.seatRequirement > 0) {
    const points = intel.seatRequirement >= 50 ? 15 : intel.seatRequirement >= 10 ? 10 : 5;
    factors.push({
      category: 'COMMERCIAL_SIGNAL',
      factor: `~${intel.seatRequirement} user seat requirement provided`,
      points,
      provenance: 'PROVIDED',
      evidence: `${intel.seatRequirement} seats`,
    });
  }

  // 4. Timing
  if (intel?.timeline) {
    const lowerTl = intel.timeline.toLowerCase();
    if (lowerTl.includes('next month') || lowerTl.includes('immediate') || lowerTl.includes('asap') || lowerTl.includes('q1') || lowerTl.includes('q2')) {
      factors.push({
        category: 'TIMING',
        factor: `Deployment timeline specified: ${intel.timeline}`,
        points: 15,
        provenance: 'PROVIDED',
        evidence: intel.timeline,
      });
    }
  }

  // 5. Fit & Company size
  if (contact.company) {
    factors.push({
      category: 'FIT',
      factor: `Associated with company: ${contact.company.name}`,
      points: 10,
      provenance: 'DERIVED',
      evidence: contact.company.domain ?? undefined,
    });
  }

  // 6. Engagement
  if (contact.conversations.length > 1) {
    factors.push({
      category: 'ENGAGEMENT',
      factor: `Multiple substantive interactions (${contact.conversations.length} sessions)`,
      points: 6,
      provenance: 'SYSTEM',
    });
  }

  const rawScore = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.min(100, Math.max(0, rawScore));

  let tier = 'Lead';
  if (score >= 70) tier = 'Qualified Lead';
  else if (score >= 40) tier = 'Engaged Prospect';

  // Update contact record
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      leadScore: score,
      leadTier: tier,
      scoreFactors: JSON.parse(JSON.stringify(factors)),
      lastActivityAt: new Date(),
    },
  });

  return {
    score,
    tier,
    factors,
    calculatedAt: new Date(),
  };
}
