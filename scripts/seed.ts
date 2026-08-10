import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AccessLevel, Role } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { hashPassword } from '@/lib/auth/password';
import { ingestSource } from '@/lib/documents/ingest';
import { ask, submitFeedback } from '@/lib/chat/service';
import {
  defaultModelSettings,
  defaultRetrievalSettings,
  MODEL_SETTINGS_KEY,
  RETRIEVAL_SETTINGS_KEY,
} from '@/lib/retrieval/settings';
import { ensureRetrievalIndexes } from './ensure-indexes';

const DEMO_PASSWORD = 'AtlasDemo!2026';

interface DemoUserSpec {
  name: string;
  email: string;
  role: Role;
}

const DEMO_USERS: DemoUserSpec[] = [
  { name: 'Amara Osei', email: 'admin@atlasknowledge.demo', role: 'ADMIN' },
  { name: 'Rohan Patel', email: 'manager@atlasknowledge.demo', role: 'MANAGER' },
  { name: 'Lena Fischer', email: 'employee@atlasknowledge.demo', role: 'EMPLOYEE' },
  { name: 'Diego Marin', email: 'customer@atlasknowledge.demo', role: 'CUSTOMER' },
  { name: 'Sam Rivera', email: 'viewer@atlasknowledge.demo', role: 'PUBLIC' },
];

const DOCUMENT_ACCESS: Record<string, { accessLevel: AccessLevel; title: string }> = {
  '01-product-manual.md': { accessLevel: 'PUBLIC', title: 'Northstar Cloud Product Manual' },
  '02-pricing-guide.md': { accessLevel: 'PUBLIC', title: 'Pricing and Subscription Guide' },
  '03-refund-policy.md': { accessLevel: 'PUBLIC', title: 'Refund and Cancellation Policy' },
  '04-support-faq.md': { accessLevel: 'PUBLIC', title: 'Customer Support FAQ' },
  '05-security-overview.md': { accessLevel: 'PUBLIC', title: 'Security and Privacy Overview' },
  '06-employee-handbook.md': { accessLevel: 'EMPLOYEE', title: 'Employee Handbook' },
  '07-sales-enablement.md': { accessLevel: 'EMPLOYEE', title: 'Sales Enablement Guide' },
  '08-incident-response.md': {
    accessLevel: 'MANAGER',
    title: 'Internal Incident Response Procedure',
  },
};

function assertSafeToSeed(): void {
  const config = env();
  if (config.ALLOW_PRODUCTION_SEED) {
    console.warn('ALLOW_PRODUCTION_SEED is true: seeding a non-local database as instructed.');
    return;
  }

  const url = config.DATABASE_URL;
  const isLocal =
    url.includes('@localhost') ||
    url.includes('@127.0.0.1') ||
    url.includes('@postgres:') ||
    url.includes('@db:');

  if (!isLocal) {
    throw new Error(
      'Refusing to seed: DATABASE_URL does not point at a local database and ALLOW_PRODUCTION_SEED is not "true".',
    );
  }
  if (config.NODE_ENV === 'production' && !config.ALLOW_PRODUCTION_SEED) {
    throw new Error(
      'Refusing to seed: NODE_ENV is production and ALLOW_PRODUCTION_SEED is not "true".',
    );
  }
}

async function seedUsers(): Promise<Map<string, { id: string; role: Role }>> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = new Map<string, { id: string; role: Role }>();

  for (const spec of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      create: {
        name: spec.name,
        email: spec.email,
        passwordHash,
        role: spec.role,
        status: 'ACTIVE',
        isDemo: true,
      },
      update: {
        name: spec.name,
        passwordHash,
        role: spec.role,
        status: 'ACTIVE',
        isDemo: true,
      },
    });
    users.set(spec.email, { id: user.id, role: user.role });
  }

  console.log(`  users: ${users.size} demo accounts ready`);
  return users;
}

async function seedSettings(adminUserId: string): Promise<void> {
  const rSettings = defaultRetrievalSettings();
  const mSettings = defaultModelSettings();

  await prisma.systemSetting.upsert({
    where: { key: RETRIEVAL_SETTINGS_KEY },
    create: {
      key: RETRIEVAL_SETTINGS_KEY,
      value: JSON.parse(JSON.stringify(rSettings)),
      updatedBy: adminUserId,
    },
    update: {
      value: JSON.parse(JSON.stringify(rSettings)),
      updatedBy: adminUserId,
    },
  });

  await prisma.systemSetting.upsert({
    where: { key: MODEL_SETTINGS_KEY },
    create: {
      key: MODEL_SETTINGS_KEY,
      value: JSON.parse(JSON.stringify(mSettings)),
      updatedBy: adminUserId,
    },
    update: {
      value: JSON.parse(JSON.stringify(mSettings)),
      updatedBy: adminUserId,
    },
  });

  const integrations = [
    { type: 'storage', name: 'Local Disk Storage', status: 'CONNECTED' as const },
    { type: 'embedding', name: 'Demo Embeddings (768d)', status: 'CONNECTED' as const },
    { type: 'llm', name: 'Demo Generator', status: 'CONNECTED' as const },
    { type: 'crm', name: 'Atlas Intelligence CRM Engine', status: 'CONNECTED' as const },
    { type: 'vector_db', name: 'PostgreSQL pgvector (HNSW)', status: 'CONNECTED' as const },
    { type: 'evaluation', name: 'Retrieval Quality Workbench', status: 'CONNECTED' as const },
  ];

  for (const item of integrations) {
    await prisma.integration.upsert({
      where: { type_name: { type: item.type, name: item.name } },
      create: {
        type: item.type,
        name: item.name,
        status: item.status,
        lastCheckedAt: new Date(),
      },
      update: {
        status: item.status,
        lastCheckedAt: new Date(),
      },
    });
  }

  console.log('  settings: retrieval, model, CRM engine, and integration records ready');
}

async function seedWorkspace(users: Map<string, { id: string; role: Role }>) {
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'northstar-cloud' },
    create: {
      name: 'Northstar Cloud',
      slug: 'northstar-cloud',
      domain: 'northstar.example',
    },
    update: {
      name: 'Northstar Cloud',
    },
  });

  for (const [, u] of users.entries()) {
    let wsRole: 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER' = 'AGENT';
    if (u.role === 'ADMIN') wsRole = 'OWNER';
    else if (u.role === 'MANAGER') wsRole = 'MANAGER';
    else if (u.role === 'PUBLIC') wsRole = 'VIEWER';

    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: u.id,
        },
      },
      create: {
        workspaceId: workspace.id,
        userId: u.id,
        role: wsRole,
      },
      update: {
        role: wsRole,
      },
    });
  }

  console.log(`  workspace: "${workspace.name}" created with members`);
  return workspace;
}

async function seedCrm(workspaceId: string, users: Map<string, { id: string; role: Role }>) {
  const admin = users.get('admin@atlasknowledge.demo');
  const manager = users.get('manager@atlasknowledge.demo');
  const employee = users.get('employee@atlasknowledge.demo');

  // 1. Companies
  const companySpecs = [
    { name: 'Acme Labs', domain: 'acme.example', industry: 'Cloud & AI', employeeRange: '50-200', country: 'United States', lifecycle: 'QUALIFIED_LEAD' as const },
    { name: 'Apex Dynamics', domain: 'apexdynamics.example', industry: 'Fintech', employeeRange: '200-500', country: 'United Kingdom', lifecycle: 'CUSTOMER' as const },
    { name: 'Horizon Health', domain: 'horizonhealth.example', industry: 'Healthcare', employeeRange: '500-1000', country: 'United States', lifecycle: 'OPPORTUNITY' as const },
    { name: 'Nexus Retail', domain: 'nexusretail.example', industry: 'E-commerce', employeeRange: '100-250', country: 'Germany', lifecycle: 'LEAD' as const },
    { name: 'Stellar Financial', domain: 'stellarfin.example', industry: 'Banking', employeeRange: '1000+', country: 'Singapore', lifecycle: 'CUSTOMER' as const },
    { name: 'CyberShield Systems', domain: 'cybershield.example', industry: 'Cybersecurity', employeeRange: '50-100', country: 'Canada', lifecycle: 'QUALIFIED_LEAD' as const },
  ];

  const companyMap = new Map<string, string>();
  for (const c of companySpecs) {
    const comp = await prisma.company.upsert({
      where: { workspaceId_domain: { workspaceId, domain: c.domain } },
      create: {
        workspaceId,
        name: c.name,
        domain: c.domain,
        website: `https://${c.domain}`,
        industry: c.industry,
        employeeRange: c.employeeRange,
        country: c.country,
        lifecycle: c.lifecycle,
        ownerId: manager?.id,
      },
      update: {
        name: c.name,
        lifecycle: c.lifecycle,
      },
    });
    companyMap.set(c.name, comp.id);
  }

  // 2. Maya Chen (Flagship Demo Buyer) + Other Contacts
  const acmeId = companyMap.get('Acme Labs');
  const apexId = companyMap.get('Apex Dynamics');
  const horizonId = companyMap.get('Horizon Health');
  const nexusId = companyMap.get('Nexus Retail');

  const maya = await prisma.contact.upsert({
    where: { workspaceId_normalizedEmail: { workspaceId, normalizedEmail: 'maya@acme.example' } },
    create: {
      workspaceId,
      firstName: 'Maya',
      lastName: 'Chen',
      displayName: 'Maya Chen',
      primaryEmail: 'maya@acme.example',
      normalizedEmail: 'maya@acme.example',
      phone: '+1 (555) 019-2834',
      visitorKey: 'visitor_maya_acme',
      companyId: acmeId,
      ownerId: manager?.id,
      lifecycleStage: 'QUALIFIED_LEAD',
      leadStatus: 'QUALIFIED',
      leadScore: 74,
      leadTier: 'Qualified Lead',
      scoreFactors: [
        { factor: 'Team plan evaluation', points: 20, provenance: 'DERIVED' },
        { factor: '~80 user requirement provided', points: 15, provenance: 'PROVIDED' },
        { factor: 'Deployment next month timeline', points: 15, provenance: 'PROVIDED' },
        { factor: 'Security controls evaluation', points: 10, provenance: 'DERIVED' },
        { factor: 'Contact details provided', points: 8, provenance: 'PROVIDED' },
        { factor: 'Multiple substantive interactions', points: 6, provenance: 'SYSTEM' },
      ],
      source: 'Public Demo',
      sourceDetail: 'Interactive Chat Assistant Session',
      preferredLanguage: 'en',
      timezone: 'America/New_York',
    },
    update: {
      leadScore: 74,
      leadStatus: 'QUALIFIED',
    },
  });

  // Customer Intelligence for Maya
  await prisma.customerIntelligence.upsert({
    where: { contactId: maya.id },
    create: {
      workspaceId,
      contactId: maya.id,
      summary:
        'Maya Chen is evaluating the Team plan for approximately 80 users at Acme Labs and wants to launch next month. She asked about pricing and security controls and explicitly requested a sales follow-up.',
      primaryIntent: 'Purchase evaluation',
      secondaryIntent: 'Security & Compliance Review',
      customerNeed: 'Governed Knowledge Engine with SAML & RBAC for 80 team members',
      painPoint: 'Internal policies scattered across PDFs with inconsistent answers',
      productInterest: 'Team Plan',
      urgency: 'HIGH',
      sentiment: 'POSITIVE',
      requestedFollowUp: true,
      timeline: 'next month',
      seatRequirement: 80,
      explicitRequirements: ['SAML SSO', 'Role-based sensitivity filters', 'SOC2 Compliance', '30-day refund guarantee'],
      recommendedNextAction: 'Schedule technical demo call with Acme Labs engineering team',
      confidence: 0.92,
      provenance: 'DERIVED',
      humanOverride: false,
      locked: false,
    },
    update: {
      summary:
        'Maya Chen is evaluating the Team plan for approximately 80 users at Acme Labs and wants to launch next month.',
    },
  });

  const additionalContacts = [
    { firstName: 'Alex', lastName: 'Vance', email: 'alex.vance@apexdynamics.example', companyId: apexId, stage: 'CUSTOMER' as const, score: 90 },
    { firstName: 'Elena', lastName: 'Rostova', email: 'elena.rostova@horizonhealth.example', companyId: horizonId, stage: 'OPPORTUNITY' as const, score: 68 },
    { firstName: 'Marcus', lastName: 'Thorne', email: 'marcus.t@nexusretail.example', companyId: nexusId, stage: 'LEAD' as const, score: 42 },
    { firstName: 'Sarah', lastName: 'Jenkins', email: 'sarah.j@acme.example', companyId: acmeId, stage: 'QUALIFIED_LEAD' as const, score: 65 },
    { firstName: 'David', lastName: 'Kim', email: 'david.kim@stellarfin.example', companyId: companyMap.get('Stellar Financial'), stage: 'CUSTOMER' as const, score: 85 },
    { firstName: 'Priya', lastName: 'Patel', email: 'p.patel@cybershield.example', companyId: companyMap.get('CyberShield Systems'), stage: 'QUALIFIED_LEAD' as const, score: 71 },
  ];

  for (const c of additionalContacts) {
    await prisma.contact.upsert({
      where: { workspaceId_normalizedEmail: { workspaceId, normalizedEmail: c.email } },
      create: {
        workspaceId,
        firstName: c.firstName,
        lastName: c.lastName,
        displayName: `${c.firstName} ${c.lastName}`,
        primaryEmail: c.email,
        normalizedEmail: c.email,
        companyId: c.companyId,
        ownerId: manager?.id,
        lifecycleStage: c.stage,
        leadStatus: c.stage === 'CUSTOMER' ? 'CLOSED' : 'OPEN',
        leadScore: c.score,
        leadTier: c.score > 70 ? 'Qualified Lead' : 'Lead',
        source: 'Website Chat',
      },
      update: {},
    });
  }

  // 3. Pipeline & Deals
  const pipeline = await prisma.pipeline.upsert({
    where: { id: 'default-sales-pipeline' },
    create: {
      id: 'default-sales-pipeline',
      workspaceId,
      name: 'Standard B2B Sales Pipeline',
      isDefault: true,
    },
    update: {},
  });

  const stageSpecs = [
    { name: 'New', order: 1, winProbability: 0.1 },
    { name: 'Qualified', order: 2, winProbability: 0.25 },
    { name: 'Discovery', order: 3, winProbability: 0.4 },
    { name: 'Evaluation', order: 4, winProbability: 0.6 },
    { name: 'Proposal', order: 5, winProbability: 0.75 },
    { name: 'Negotiation', order: 6, winProbability: 0.9 },
    { name: 'Won', order: 7, winProbability: 1.0 },
    { name: 'Lost', order: 8, winProbability: 0.0 },
  ];

  const stageMap = new Map<string, string>();
  for (const st of stageSpecs) {
    const stage = await prisma.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        name: st.name,
        order: st.order,
        winProbability: st.winProbability,
      },
    });
    stageMap.set(st.name, stage.id);
  }

  // Acme Labs Deal
  const evalStageId = (stageMap.get('Evaluation') ?? stageMap.values().next().value) as string;
  await prisma.deal.create({
    data: {
      workspaceId,
      name: 'Acme Labs — 80 User Team Expansion',
      pipelineId: pipeline.id,
      stageId: evalStageId,
      primaryCompanyId: acmeId,
      primaryContactId: maya.id,
      ownerId: manager?.id,
      amount: 24000,
      currency: 'USD',
      probability: 0.6,
      expectedCloseDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      source: 'Public Demo Assistant',
      status: 'OPEN',
    },
  });

  // Apex Dynamics Deal
  const wonStageId = stageMap.get('Won') ?? evalStageId;
  await prisma.deal.create({
    data: {
      workspaceId,
      name: 'Apex Dynamics — Enterprise Workspace License',
      pipelineId: pipeline.id,
      stageId: wonStageId,
      primaryCompanyId: apexId,
      ownerId: admin?.id,
      amount: 48000,
      currency: 'USD',
      probability: 1.0,
      status: 'WON',
      closedAt: new Date(),
    },
  });

  // 4. Tasks & Tickets
  await prisma.task.create({
    data: {
      workspaceId,
      title: 'Follow up with Maya Chen (Acme Labs)',
      description: 'Review Team plan security documentation and schedule 80-seat onboarding call.',
      type: 'FOLLOW_UP',
      status: 'PENDING',
      priority: 'HIGH',
      ownerId: manager?.id,
      contactId: maya.id,
      companyId: acmeId,
      dueAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      createdBy: admin?.id,
    },
  });

  await prisma.task.create({
    data: {
      workspaceId,
      title: 'Send SOC2 Type II compliance package to CyberShield Systems',
      type: 'EMAIL',
      status: 'PENDING',
      priority: 'NORMAL',
      ownerId: employee?.id,
      companyId: companyMap.get('CyberShield Systems'),
      dueAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
    },
  });

  await prisma.ticket.create({
    data: {
      workspaceId,
      subject: 'Inquiry on SAML SSO configuration for Azure AD',
      description: 'Customer asking for step-by-step metadata XML upload guide for single sign-on.',
      status: 'OPEN',
      priority: 'HIGH',
      contactId: maya.id,
      companyId: acmeId,
      assigneeId: manager?.id,
      category: 'Authentication',
      productArea: 'SSO / Identity',
      urgency: 'HIGH',
    },
  });

  // 5. Automation Rules
  await prisma.automationRule.create({
    data: {
      workspaceId,
      name: 'High Lead Score Opportunity Creation',
      description: 'Automatically notify assigned account owner when lead score reaches 70+',
      trigger: 'LEAD_SCORE_CHANGED',
      conditions: [{ field: 'leadScore', operator: 'gte', value: 70 }],
      actions: [{ type: 'CREATE_TASK', params: { title: 'Follow up with qualified high-scoring prospect' } }],
      active: true,
    },
  });

  await prisma.automationRule.create({
    data: {
      workspaceId,
      name: 'Negative Feedback Support Escalation',
      description: 'Create support ticket when a customer marks an answer as unhelpful',
      trigger: 'NEGATIVE_FEEDBACK',
      conditions: [{ field: 'rating', operator: 'equals', value: 'NOT_HELPFUL' }],
      actions: [{ type: 'CREATE_TICKET', params: { priority: 'HIGH' } }],
      active: true,
    },
  });

  console.log('  crm: companies, contacts, Maya Chen intelligence, pipeline, deals, tasks, tickets & automation rules ready');
}

const SEED_TURNS: {
  email: string;
  question: string;
  role: Role;
  giveFeedback?: { rating: 'HELPFUL' | 'NOT_HELPFUL'; reason?: 'WRONG_SOURCE'; comment?: string };
}[] = [
  {
    email: 'admin@atlasknowledge.demo',
    role: 'ADMIN',
    question: 'What is our official SLA for system availability and incident notification?',
  },
  {
    email: 'manager@atlasknowledge.demo',
    role: 'MANAGER',
    question: 'When does the 72 hour notification clock start for severe incidents?',
  },
  {
    email: 'employee@atlasknowledge.demo',
    role: 'EMPLOYEE',
    question: 'What is our policy on remote work password security and VPN requirements?',
  },
  {
    email: 'employee@atlasknowledge.demo',
    role: 'EMPLOYEE',
    question: 'How should I handle a prospect asking about HIPAA compliance?',
  },
  {
    email: 'customer@atlasknowledge.demo',
    role: 'CUSTOMER',
    question: 'What is the refund window for an annual subscription?',
    giveFeedback: { rating: 'HELPFUL' },
  },
  {
    email: 'customer@atlasknowledge.demo',
    role: 'CUSTOMER',
    question: 'Does that refund window apply to monthly plans too?',
  },
  {
    email: 'viewer@atlasknowledge.demo',
    role: 'PUBLIC',
    question: 'What features are included in the Northstar Cloud Team plan?',
  },
  {
    email: 'viewer@atlasknowledge.demo',
    role: 'PUBLIC',
    question: 'What encryption standard is used for customer data at rest?',
  },
  {
    email: 'viewer@atlasknowledge.demo',
    role: 'PUBLIC',
    question: 'How do I configure custom SAML SSO single sign on?',
    giveFeedback: {
      rating: 'NOT_HELPFUL',
      reason: 'WRONG_SOURCE',
      comment: 'The public FAQ does not include step-by-step XML metadata upload steps.',
    },
  },
  {
    email: 'viewer@atlasknowledge.demo',
    role: 'PUBLIC',
    question: 'Can you provide the direct internal VPN gateway IP address for engineering?',
  },
];

async function seedDocuments(knowledgeBaseId: string, adminUserId: string): Promise<void> {
  const sampleDir = path.join(process.cwd(), 'sample-data', 'documents');
  const files = (await readdir(sampleDir)).filter((f) => f.endsWith('.md')).sort();

  for (const filename of files) {
    const spec = DOCUMENT_ACCESS[filename] ?? {
      accessLevel: 'PUBLIC' as const,
      title: filename,
    };
    const absolutePath = path.join(sampleDir, filename);
    const content = await readFile(absolutePath, 'utf8');

    const result = await ingestSource({
      knowledgeBaseId,
      sourceType: 'MARKDOWN',
      title: spec.title,
      originalFilename: filename,
      accessLevel: spec.accessLevel,
      uploadedBy: adminUserId,
      bytes: Buffer.from(content, 'utf8'),
      mimeType: 'text/markdown',
    });

    console.log(`  ingested: "${spec.title}" (${result.chunkCount} chunks, access=${spec.accessLevel})`);
  }
}

async function seedConversations(
  users: Map<string, { id: string; role: Role }>,
  knowledgeBaseId: string,
): Promise<void> {
  let supported = 0;
  let unsupported = 0;
  let escalations = 0;

  for (let i = 0; i < SEED_TURNS.length; i++) {
    const spec = SEED_TURNS[i];
    const user = users.get(spec.email);
    if (!user) continue;

    const timestamp = new Date(Date.now() - (SEED_TURNS.length - i) * 3600 * 1000);

    const result = await ask({
      question: spec.question,
      userId: user.id,
      knowledgeBaseId,
      role: spec.role,
    });

    if (result.answer.grounding === 'SUPPORTED' || result.answer.grounding === 'PARTIALLY_SUPPORTED') {
      supported++;
    } else {
      unsupported++;
    }
    if (Boolean(result.escalationId)) escalations++;

    if (spec.giveFeedback && result.messageId) {
      await submitFeedback({
        messageId: result.messageId,
        userId: user.id,
        rating: spec.giveFeedback.rating,
        reason: spec.giveFeedback.reason,
        comment: spec.giveFeedback.comment,
      });
    }

    await prisma.$executeRaw`
      UPDATE "Conversation" SET "createdAt" = ${timestamp}, "updatedAt" = ${timestamp} WHERE "id" = ${result.conversationId}
    `;
  }

  console.log(
    `  conversations: ${SEED_TURNS.length} questions asked (${supported} answered, ${unsupported} unsupported), ${escalations} escalations raised`,
  );
}

async function seedEscalationStates(users: Map<string, { id: string; role: Role }>): Promise<void> {
  const manager = users.get('manager@atlasknowledge.demo');
  if (!manager) return;

  const open = await prisma.escalation.findMany({ orderBy: { createdAt: 'asc' }, take: 3 });
  if (open.length === 0) return;

  if (open[0]) {
    await prisma.escalation.update({
      where: { id: open[0].id },
      data: {
        status: 'RESOLVED',
        assignedTo: manager.id,
        resolutionNote:
          'Confirmed the handbook is employee-restricted. Replied to the customer with the public support policy instead.',
      },
    });
  }
  if (open[1]) {
    await prisma.escalation.update({
      where: { id: open[1].id },
      data: { status: 'IN_PROGRESS', assignedTo: manager.id },
    });
  }

  console.log('  escalations: assigned and progressed a sample for the queue view');
}

async function main() {
  console.log('Seeding Atlas Knowledge AI demo data...');
  assertSafeToSeed();

  const indexes = await ensureRetrievalIndexes();
  if (indexes.created.length > 0) {
    console.log(`  indexes: restored ${indexes.created.join(', ')}`);
  }

  const users = await seedUsers();
  const admin = users.get('admin@atlasknowledge.demo');
  if (!admin) throw new Error('Admin demo user was not created.');

  await seedSettings(admin.id);

  const workspace = await seedWorkspace(users);
  await seedCrm(workspace.id, users);

  const knowledgeBase = await prisma.knowledgeBase.upsert({
    where: { slug: 'northstar-cloud' },
    create: {
      name: 'Northstar Cloud Knowledge Base',
      slug: 'northstar-cloud',
      description:
        'Approved product, pricing, policy, and internal documentation for the fictional Northstar Cloud platform.',
      visibility: 'INTERNAL',
      ownerId: admin.id,
      workspaceId: workspace.id,
    },
    update: {
      ownerId: admin.id,
      workspaceId: workspace.id,
    },
  });
  console.log(`  knowledge base: "${knowledgeBase.name}" ready`);

  const existingDocuments = await prisma.document.count({
    where: { knowledgeBaseId: knowledgeBase.id },
  });

  if (existingDocuments > 0) {
    console.log(`  documents: ${existingDocuments} already present, skipping ingestion`);
  } else {
    await seedDocuments(knowledgeBase.id, admin.id);
  }

  const existingConversations = await prisma.conversation.count();
  if (existingConversations > 0) {
    console.log(`  conversations: ${existingConversations} already present, skipping`);
  } else {
    await seedConversations(users, knowledgeBase.id);
    await seedEscalationStates(users);
  }

  console.log('\nSeed complete.');
  console.log('Demo sign-in (only valid while DEMO_MODE=true):');
  for (const spec of DEMO_USERS) {
    console.log(`  ${spec.role.padEnd(9)} ${spec.email}  /  ${DEMO_PASSWORD}`);
  }
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
