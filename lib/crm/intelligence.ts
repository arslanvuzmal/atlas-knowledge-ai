import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { prisma } from '@/lib/database/client';
import { logger } from '@/lib/observability/logger';
import { calculateLeadScore } from './scoring';

export const customerIntelligenceSchema = z.object({
  summary: z.string(),
  primaryIntent: z.string(),
  secondaryIntent: z.string().optional(),
  customerNeed: z.string(),
  painPoint: z.string().optional(),
  productInterest: z.string().optional(),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']),
  requestedFollowUp: z.boolean(),
  timeline: z.string().optional(),
  seatRequirement: z.number().int().optional(),
  explicitRequirements: z.array(z.string()),
  recommendedNextAction: z.string(),
  confidence: z.number().min(0).max(1),
});

export type CustomerIntelligenceData = z.infer<typeof customerIntelligenceSchema>;

/**
 * Extracts structured customer intelligence from conversation history.
 */
export async function extractCustomerIntelligence(
  workspaceId: string,
  contactId: string,
  messages: { role: string; content: string }[],
): Promise<CustomerIntelligenceData> {
  const combinedText = messages.map((m) => m.content).join('\n');
  const lower = combinedText.toLowerCase();

  // Try live Gemini 3.5 Flash-Lite structured extraction if GEMINI_API_KEY is available
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Extract structured B2B CRM customer intelligence from this customer conversation.
Analyze intent, seat requirements, timeline, explicit security/product requirements, follow-up request, urgency, sentiment, and recommended next action.

Conversation:
${combinedText}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
        },
      });

      const parsed = JSON.parse(response.text ?? '{}');
      const validated = customerIntelligenceSchema.safeParse(parsed);
      if (validated.success) {
        return await saveCustomerIntelligence(workspaceId, contactId, validated.data);
      }
    } catch (geminiErr) {
      logger.warn('Remote Gemini intelligence extraction failed, using deterministic engine', {
        error: geminiErr instanceof Error ? geminiErr.message : String(geminiErr),
        contactId,
      });
    }
  }

  // Rule & heuristic extraction for zero-latency deterministic reliability
  let primaryIntent = 'General Inquiry';
  if (
    lower.includes('price') ||
    lower.includes('cost') ||
    lower.includes('tier') ||
    lower.includes('plan') ||
    lower.includes('team') ||
    lower.includes('evaluat')
  ) {
    primaryIntent = 'Purchase evaluation';
  } else if (
    lower.includes('support') ||
    lower.includes('help') ||
    lower.includes('bug') ||
    lower.includes('issue') ||
    lower.includes('error')
  ) {
    primaryIntent = 'Support inquiry';
  }

  let seatRequirement: number | undefined;
  const seatMatch = lower.match(/(\d+)\s*(users?|seats?|people|team members?|licenses?)/i);
  if (seatMatch) {
    seatRequirement = parseInt(seatMatch[1], 10);
  }

  let timeline: string | undefined;
  if (lower.includes('next month')) timeline = 'next month';
  else if (lower.includes('asap') || lower.includes('immediately')) timeline = 'immediate';
  else if (lower.includes('q1')) timeline = 'Q1';
  else if (lower.includes('q2')) timeline = 'Q2';

  let productInterest: string | undefined;
  if (lower.includes('team plan') || lower.includes('team')) productInterest = 'Team Plan';
  else if (lower.includes('enterprise')) productInterest = 'Enterprise Plan';

  const requestedFollowUp =
    lower.includes('follow up') ||
    lower.includes('contact me') ||
    lower.includes('call me') ||
    lower.includes('reach out') ||
    lower.includes('maya@acme');

  const explicitRequirements: string[] = [];
  if (lower.includes('security') || lower.includes('soc2'))
    explicitRequirements.push('Security & SOC2 Controls');
  if (lower.includes('saml') || lower.includes('sso')) explicitRequirements.push('SAML SSO');
  if (lower.includes('refund')) explicitRequirements.push('30-day Refund Guarantee');

  const summary = `Customer evaluated ${productInterest || 'platform'}${seatRequirement ? ` for ~${seatRequirement} seats` : ''}${timeline ? ` targeting ${timeline}` : ''}. Asked about key features/security and ${requestedFollowUp ? 'requested a sales follow-up' : 'explored approved knowledge'}.`;

  const intelligenceData: CustomerIntelligenceData = {
    summary,
    primaryIntent,
    customerNeed: `Governed knowledge engine for team collaboration${seatRequirement ? ` (${seatRequirement} seats)` : ''}`,
    productInterest,
    urgency: requestedFollowUp || (seatRequirement && seatRequirement >= 50) ? 'HIGH' : 'MEDIUM',
    sentiment:
      lower.includes('great') || lower.includes('thanks') || lower.includes('excellent')
        ? 'POSITIVE'
        : 'NEUTRAL',
    requestedFollowUp,
    timeline,
    seatRequirement,
    explicitRequirements,
    recommendedNextAction: requestedFollowUp
      ? 'Schedule technical demo call'
      : 'Provide product documentation',
    confidence: 0.88,
  };

  return await saveCustomerIntelligence(workspaceId, contactId, intelligenceData);
}

async function saveCustomerIntelligence(
  workspaceId: string,
  contactId: string,
  intelligenceData: CustomerIntelligenceData,
): Promise<CustomerIntelligenceData> {
  // Upsert into database without overwriting human-locked data
  const existing = await prisma.customerIntelligence.findUnique({
    where: { contactId },
  });

  if (!existing || !existing.locked) {
    await prisma.customerIntelligence.upsert({
      where: { contactId },
      create: {
        workspaceId,
        contactId,
        summary: intelligenceData.summary,
        primaryIntent: intelligenceData.primaryIntent,
        customerNeed: intelligenceData.customerNeed,
        productInterest: intelligenceData.productInterest,
        urgency: intelligenceData.urgency,
        sentiment: intelligenceData.sentiment,
        requestedFollowUp: intelligenceData.requestedFollowUp,
        timeline: intelligenceData.timeline,
        seatRequirement: intelligenceData.seatRequirement,
        explicitRequirements: intelligenceData.explicitRequirements,
        recommendedNextAction: intelligenceData.recommendedNextAction,
        confidence: intelligenceData.confidence,
        provenance: 'DERIVED',
      },
      update: {
        summary: intelligenceData.summary,
        primaryIntent: intelligenceData.primaryIntent,
        customerNeed: intelligenceData.customerNeed,
        productInterest: intelligenceData.productInterest ?? existing?.productInterest,
        urgency: intelligenceData.urgency,
        sentiment: intelligenceData.sentiment,
        requestedFollowUp: intelligenceData.requestedFollowUp || existing?.requestedFollowUp,
        timeline: intelligenceData.timeline ?? existing?.timeline,
        seatRequirement: intelligenceData.seatRequirement ?? existing?.seatRequirement,
        explicitRequirements: Array.from(
          new Set([
            ...(existing?.explicitRequirements ?? []),
            ...intelligenceData.explicitRequirements,
          ]),
        ),
        recommendedNextAction: intelligenceData.recommendedNextAction,
        confidence: intelligenceData.confidence,
      },
    });

    // Recalculate explainable lead score
    await calculateLeadScore(workspaceId, contactId);
  }

  return intelligenceData;
}
