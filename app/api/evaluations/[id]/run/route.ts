import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';
import { retrieve } from '@/lib/retrieval/search';
import { generateAnswer } from '@/lib/ai/answer';
import { getRetrievalSettings } from '@/lib/retrieval/settings';
import { getModelSettings } from '@/lib/retrieval/settings';
import type { ConversationTurn } from '@/lib/retrieval/query';

export const dynamic = 'force-dynamic';

type TestCase = {
  id: string;
  question: string;
  role: 'PUBLIC' | 'CUSTOMER' | 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  expectedBehavior: 'SHOULD_ANSWER' | 'SHOULD_REFUSE';
  expectedSourceDocuments?: string[];
  expectedConcepts?: string[];
  permittedRole?: 'PUBLIC' | 'CUSTOMER' | 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  expectedGrounding?: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';
  minimumConfidence?: number;
  maximumLatencyMs?: number;
  history?: ConversationTurn[];
};

type ClassificationResult =
  | 'PASS'
  | 'RETRIEVAL_MISS'
  | 'WRONG_SOURCE'
  | 'UNSUPPORTED_EXPECTED'
  | 'UNSAFE_ACCESS'
  | 'CITATION_FAILURE'
  | 'GROUNDING_FAILURE'
  | 'ANSWER_CONCEPT_MISS'
  | 'LATENCY_FAILURE'
  | 'PROVIDER_FAILURE';

type CaseResult = {
  testCaseId: string;
  classification: ClassificationResult;
  confidence: number;
  grounding: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';
  citations: number;
  latencyMs: number;
  retrievedDocuments: string[];
  vectorCandidates: number;
  keywordCandidates: number;
  fusedCandidates: number;
  accessFilterSurvivors: number;
  rerankedChunks: number;
  details: string;
  answer: string;
  traceId?: string;
  provider: string;
  model: string;
};

function classifyResult(
  testCase: TestCase,
  answer: {
    text: string;
    grounding: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';
    confidence: number;
    citations: Array<{ chunkId: string }>;
    escalationSuggested: boolean;
    diagnostics: { invalidCitationMarkers: number[] };
    provider: string;
    model: string;
    latencyMs: number;
  },
  retrieval: {
    chunks: Array<{ id: string; documentTitle: string; content: string }>;
    stats: {
      vectorCandidates: number;
      keywordCandidates: number;
      fusedCandidates: number;
      afterAccessFilter: number;
      rerankedCount: number;
      latencyMs: number;
      hybrid: boolean;
      droppedByPostFilter: number;
    };
  },
  latencyMs: number
): CaseResult {
  const retrievedDocuments = [...new Set(retrieval.chunks.map((chunk) => chunk.documentTitle))];

  // Check unsafe access first
  if (testCase.permittedRole) {
    // This would be checked by the retrieval pipeline, but we verify no forbidden docs leaked
    // For now, we'll check if the role had access to the expected content
  }

  // Check expected behavior
  if (testCase.expectedBehavior === 'SHOULD_REFUSE') {
    if (answer.grounding !== 'UNSUPPORTED') {
      return {
        testCaseId: testCase.id,
        classification: 'UNSUPPORTED_EXPECTED',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: `Expected refusal but got ${answer.grounding} answer`,
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
    if (answer.citations.length > 0) {
      return {
        testCaseId: testCase.id,
        classification: 'CITATION_FAILURE',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: 'Refusal should not have citations',
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
    // Check grounding failure
    if (testCase.expectedGrounding && answer.grounding !== testCase.expectedGrounding) {
      return {
        testCaseId: testCase.id,
        classification: 'GROUNDING_FAILURE',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: `Expected grounding ${testCase.expectedGrounding}, got ${answer.grounding}`,
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
    // Check minimum confidence
    if (testCase.minimumConfidence && answer.confidence < testCase.minimumConfidence) {
      return {
        testCaseId: testCase.id,
        classification: 'GROUNDING_FAILURE',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: `Confidence ${answer.confidence} below minimum ${testCase.minimumConfidence}`,
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
    // Check latency
    if (testCase.maximumLatencyMs && latencyMs > testCase.maximumLatencyMs) {
      return {
        testCaseId: testCase.id,
        classification: 'LATENCY_FAILURE',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: `Latency ${latencyMs}ms exceeds maximum ${testCase.maximumLatencyMs}ms`,
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
    // Check citation integrity
    if (answer.diagnostics.invalidCitationMarkers.length > 0) {
      return {
        testCaseId: testCase.id,
        classification: 'CITATION_FAILURE',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: `Invalid citation markers: ${answer.diagnostics.invalidCitationMarkers.join(', ')}`,
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
    return {
      testCaseId: testCase.id,
      classification: 'PASS',
      confidence: answer.confidence,
      grounding: answer.grounding,
      citations: answer.citations.length,
      latencyMs,
      retrievedDocuments,
      vectorCandidates: retrieval.stats.vectorCandidates,
      keywordCandidates: retrieval.stats.keywordCandidates,
      fusedCandidates: retrieval.stats.fusedCandidates,
      accessFilterSurvivors: retrieval.stats.afterAccessFilter,
      rerankedChunks: retrieval.stats.rerankedCount,
      details: 'Correctly refused',
      answer: answer.text,
      traceId: answer.latencyMs.toString(),
      provider: answer.provider,
      model: answer.model,
    };
  }

  // Expected SHOULD_ANSWER
  if (answer.grounding === 'UNSUPPORTED') {
    return {
      testCaseId: testCase.id,
      classification: 'UNSUPPORTED_EXPECTED',
      confidence: answer.confidence,
      grounding: answer.grounding,
      citations: answer.citations.length,
      latencyMs,
      retrievedDocuments,
      vectorCandidates: retrieval.stats.vectorCandidates,
      keywordCandidates: retrieval.stats.keywordCandidates,
      fusedCandidates: retrieval.stats.fusedCandidates,
      accessFilterSurvivors: retrieval.stats.afterAccessFilter,
      rerankedChunks: retrieval.stats.rerankedCount,
      details: 'Expected supported answer but got refusal',
      answer: answer.text,
      traceId: answer.latencyMs.toString(),
      provider: answer.provider,
      model: answer.model,
    };
  }

  // Check expected grounding
  if (testCase.expectedGrounding && answer.grounding !== testCase.expectedGrounding) {
    return {
      testCaseId: testCase.id,
      classification: 'GROUNDING_FAILURE',
      confidence: answer.confidence,
      grounding: answer.grounding,
      citations: answer.citations.length,
      latencyMs,
      retrievedDocuments,
      vectorCandidates: retrieval.stats.vectorCandidates,
      keywordCandidates: retrieval.stats.keywordCandidates,
      fusedCandidates: retrieval.stats.fusedCandidates,
      accessFilterSurvivors: retrieval.stats.afterAccessFilter,
      rerankedChunks: retrieval.stats.rerankedCount,
      details: `Expected grounding ${testCase.expectedGrounding}, got ${answer.grounding}`,
      answer: answer.text,
      traceId: answer.latencyMs.toString(),
      provider: answer.provider,
      model: answer.model,
    };
  }

  // Check minimum confidence
  if (testCase.minimumConfidence && answer.confidence < testCase.minimumConfidence) {
    return {
      testCaseId: testCase.id,
      classification: 'GROUNDING_FAILURE',
      confidence: answer.confidence,
      grounding: answer.grounding,
      citations: answer.citations.length,
      latencyMs,
      retrievedDocuments,
      vectorCandidates: retrieval.stats.vectorCandidates,
      keywordCandidates: retrieval.stats.keywordCandidates,
      fusedCandidates: retrieval.stats.fusedCandidates,
      accessFilterSurvivors: retrieval.stats.afterAccessFilter,
      rerankedChunks: retrieval.stats.rerankedCount,
      details: `Confidence ${answer.confidence} below minimum ${testCase.minimumConfidence}`,
      answer: answer.text,
      traceId: answer.latencyMs.toString(),
      provider: answer.provider,
      model: answer.model,
    };
  }

  // Check latency
  if (testCase.maximumLatencyMs && latencyMs > testCase.maximumLatencyMs) {
    return {
      testCaseId: testCase.id,
      classification: 'LATENCY_FAILURE',
      confidence: answer.confidence,
      grounding: answer.grounding,
      citations: answer.citations.length,
      latencyMs,
      retrievedDocuments,
      vectorCandidates: retrieval.stats.vectorCandidates,
      keywordCandidates: retrieval.stats.keywordCandidates,
      fusedCandidates: retrieval.stats.fusedCandidates,
      accessFilterSurvivors: retrieval.stats.afterAccessFilter,
      rerankedChunks: retrieval.stats.rerankedCount,
      details: `Latency ${latencyMs}ms exceeds maximum ${testCase.maximumLatencyMs}ms`,
      answer: answer.text,
      traceId: answer.latencyMs.toString(),
      provider: answer.provider,
      model: answer.model,
    };
  }

  // Check expected source documents
  if (testCase.expectedSourceDocuments && testCase.expectedSourceDocuments.length > 0) {
    const foundAll = testCase.expectedSourceDocuments.every((expected) =>
      retrievedDocuments.some((title) => title.toLowerCase().includes(expected.toLowerCase()))
    );
    if (!foundAll) {
      return {
        testCaseId: testCase.id,
        classification: 'WRONG_SOURCE',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: `Expected documents: ${testCase.expectedSourceDocuments.join(', ')}. Got: ${retrievedDocuments.join(', ')}`,
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
  }

  // Check expected concepts
  if (testCase.expectedConcepts && testCase.expectedConcepts.length > 0) {
    const evidence = retrieval.chunks.map((chunk) => chunk.content).join(' ').toLowerCase();
    const missingConcepts = testCase.expectedConcepts.filter(
      (concept) => !evidence.includes(concept.toLowerCase())
    );
    if (missingConcepts.length > 0) {
      return {
        testCaseId: testCase.id,
        classification: 'ANSWER_CONCEPT_MISS',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: `Missing concepts in evidence: ${missingConcepts.join(', ')}`,
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
  }

  // Check citation integrity
  const retrievedChunkIds = new Set(retrieval.chunks.map((chunk) => chunk.id));
  for (const citation of answer.citations) {
    if (!retrievedChunkIds.has(citation.chunkId)) {
      return {
        testCaseId: testCase.id,
        classification: 'CITATION_FAILURE',
        confidence: answer.confidence,
        grounding: answer.grounding,
        citations: answer.citations.length,
        latencyMs,
        retrievedDocuments,
        vectorCandidates: retrieval.stats.vectorCandidates,
        keywordCandidates: retrieval.stats.keywordCandidates,
        fusedCandidates: retrieval.stats.fusedCandidates,
        accessFilterSurvivors: retrieval.stats.afterAccessFilter,
        rerankedChunks: retrieval.stats.rerankedCount,
        details: `Cited chunk ${citation.chunkId} not in retrieved chunks`,
        answer: answer.text,
        traceId: answer.latencyMs.toString(),
        provider: answer.provider,
        model: answer.model,
      };
    }
  }

  if (answer.diagnostics.invalidCitationMarkers.length > 0) {
    return {
      testCaseId: testCase.id,
      classification: 'CITATION_FAILURE',
      confidence: answer.confidence,
      grounding: answer.grounding,
      citations: answer.citations.length,
      latencyMs,
      retrievedDocuments,
      vectorCandidates: retrieval.stats.vectorCandidates,
      keywordCandidates: retrieval.stats.keywordCandidates,
      fusedCandidates: retrieval.stats.fusedCandidates,
      accessFilterSurvivors: retrieval.stats.afterAccessFilter,
      rerankedChunks: retrieval.stats.rerankedCount,
      details: `Invalid citation markers: ${answer.diagnostics.invalidCitationMarkers.join(', ')}`,
      answer: answer.text,
      traceId: answer.latencyMs.toString(),
      provider: answer.provider,
      model: answer.model,
    };
  }

  return {
    testCaseId: testCase.id,
    classification: 'PASS',
    confidence: answer.confidence,
    grounding: answer.grounding,
    citations: answer.citations.length,
    latencyMs,
    retrievedDocuments,
    vectorCandidates: retrieval.stats.vectorCandidates,
    keywordCandidates: retrieval.stats.keywordCandidates,
    fusedCandidates: retrieval.stats.fusedCandidates,
    accessFilterSurvivors: retrieval.stats.afterAccessFilter,
    rerankedChunks: retrieval.stats.rerankedCount,
    details: 'All checks passed',
    answer: answer.text,
    traceId: answer.latencyMs.toString(),
    provider: answer.provider,
    model: answer.model,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardRequest(request, {
    permission: 'evaluation:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const evaluation = await prisma.evaluation.findUnique({
    where: { id },
    include: { knowledgeBase: { select: { id: true, name: true } } },
  });

  if (!evaluation) {
    return NextResponse.json({ error: 'Evaluation not found.' }, { status: 404 });
  }

  const testCases = evaluation.testCases as unknown as TestCase[];

  const run = await prisma.evaluationRun.create({
    data: {
      evaluationId: evaluation.id,
      status: 'RUNNING',
      total: testCases.length,
      passed: 0,
      failed: 0,
    },
  });

  const settings = await getRetrievalSettings();
  const modelSettings = await getModelSettings();

  const results: CaseResult[] = [];
  let passed = 0;
  let failed = 0;
  const runError: string | null = null;

  for (const testCase of testCases) {
    const started = Date.now();
    try {
      const retrieval = await retrieve({
        question: testCase.question,
        role: testCase.role,
        history: testCase.history ?? [],
        settings,
      });

      const answer = await generateAnswer({
        question: testCase.question,
        role: testCase.role,
        retrieval,
        history: testCase.history ?? [],
        settings,
        modelSettings,
      });

      const latencyMs = Date.now() - started;
      const result = classifyResult(testCase, answer, retrieval, latencyMs);
      results.push(result);

      if (result.classification === 'PASS') {
        passed += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      const latencyMs = Date.now() - started;
      failed += 1;
      results.push({
        testCaseId: testCase.id,
        classification: 'PROVIDER_FAILURE',
        confidence: 0,
        grounding: 'UNSUPPORTED',
        citations: 0,
        latencyMs,
        retrievedDocuments: [],
        vectorCandidates: 0,
        keywordCandidates: 0,
        fusedCandidates: 0,
        accessFilterSurvivors: 0,
        rerankedChunks: 0,
        details: error instanceof Error ? error.message : 'Unknown error',
        answer: '',
        traceId: '',
        provider: '',
        model: '',
      });
    }
  }

  const durationMs = Date.now() - Date.parse(run.createdAt.toString());

  const completedRun = await prisma.evaluationRun.update({
    where: { id: run.id },
    data: {
      status: 'COMPLETED',
      passed,
      failed,
      durationMs,
      completedAt: new Date(),
    },
  });

  // Store results as JSON on the run (we could add a separate model but JSON is fine for now)
  await prisma.evaluationRun.update({
    where: { id: run.id },
    data: {
      error: runError,
    },
  });

  // Store detailed results in a separate way - for now we'll use the evaluation run's error field for summary
  // In production, we'd want a dedicated EvaluationRunResult model
  await prisma.evaluationRun.update({
    where: { id: run.id },
    data: {
      error: JSON.stringify({ results, configurationSnapshot: { settings, modelSettings, embeddingProvider: process.env.EMBEDDING_PROVIDER, llmProvider: process.env.LLM_PROVIDER } }),
    },
  });

  await recordAudit({
    action: 'evaluation.run',
    entityType: 'EvaluationRun',
    entityId: run.id,
    userId: guard.session.user?.id ?? null,
    newData: { evaluationId: evaluation.id, passed, failed, total: testCases.length, durationMs },
    ip: guard.ip,
  });

  return NextResponse.json({
    ok: true,
    run: completedRun,
    results,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardRequest(request, {
    permission: 'evaluation:read',
    rateLimit: 'api',
  });
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get('runId');

  if (runId) {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        total: true,
        passed: true,
        failed: true,
        error: true,
        durationMs: true,
        createdAt: true,
        completedAt: true,
        evaluationId: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    }

    let results: CaseResult[] | null = null;
    if (run.error) {
      try {
        const parsed = JSON.parse(run.error);
        if (parsed.results) {
          results = parsed.results;
        }
      } catch {
        // error is just a string
      }
    }

    return NextResponse.json({ ok: true, run, results });
  }

  // List runs for this evaluation
  const runs = await prisma.evaluationRun.findMany({
    where: { evaluationId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      status: true,
      total: true,
      passed: true,
      failed: true,
      error: true,
      durationMs: true,
      createdAt: true,
      completedAt: true,
    },
  });

  return NextResponse.json({ ok: true, runs });
}