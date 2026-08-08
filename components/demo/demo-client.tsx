'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChatPanel } from '@/components/chat/chat-panel';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { Badge, Panel, PanelHeader } from '@/components/ui/primitives';
import type { PipelineMetadata } from '@/components/chat/types';

const SCENARIO_QUESTIONS = [
  {
    phase: 'Public documentation',
    description: 'These questions are answerable from public sources.',
    questions: [
      'What is the refund window for an annual subscription?',
      'How much does the Team plan cost per user?',
      'What encryption is used for data at rest?',
    ],
  },
  {
    phase: 'Access control challenge',
    description:
      'This question is deliberately restricted — public visitors cannot see the answer.',
    questions: ['How many days of annual leave do employees receive?'],
    restricted: true,
  },
  {
    phase: 'Unsupported / not in corpus',
    description: 'The knowledge base does not cover this topic.',
    questions: ['Do you offer a native mobile app?', 'Why did my Flow stop running?'],
    unsupported: true,
  },
];

type RoleCard = {
  role: string;
  label: string;
  reach: string;
  color: 'neutral' | 'accent' | 'iris' | 'warning' | 'good';
};

const ROLE_CARDS: RoleCard[] = [
  { role: 'PUBLIC', label: 'Public visitor', reach: 'Public docs only', color: 'neutral' },
  { role: 'CUSTOMER', label: 'Customer', reach: 'Public + Customer', color: 'accent' },
  { role: 'EMPLOYEE', label: 'Employee', reach: 'Public + Customer + Employee', color: 'iris' },
  {
    role: 'MANAGER',
    label: 'Manager',
    reach: 'Public + Customer + Employee + Manager',
    color: 'warning',
  },
  { role: 'ADMIN', label: 'Admin', reach: 'All documents + config', color: 'good' },
];

export function DemoClient({ demoMode }: { demoMode: boolean }) {
  const [pipelineMeta, setPipelineMeta] = useState<PipelineMetadata | null>(null);

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-edge">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="rounded-md">
            <Wordmark size={24} />
          </Link>
          <div className="flex items-center gap-2">
            {demoMode ? <DemoBadge className="hidden sm:inline-flex" /> : null}
            <Link
              href="/login"
              className="rounded-md border border-edge-strong px-3 py-1.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <div className="shrink-0 border-b border-edge bg-canvas-sunken px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-3">
          <p className="text-xs text-ink-muted">
            You are browsing anonymously as a <strong className="text-ink">Public visitor</strong> —
            only <strong className="text-ink">public</strong> sources are reachable. Try the
            questions below to see Atlas in action.
          </p>

          {/* Pipeline explanation */}
          <Panel>
            <PanelHeader
              title="How Atlas answers"
              description="The pipeline that runs for every question"
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="accent">1. Understand question</Badge>
              <span className="text-ink-faint">→</span>
              <Badge tone="accent">2. Apply access policy</Badge>
              <span className="text-ink-faint">→</span>
              <Badge tone="accent">3. Retrieve evidence</Badge>
              <span className="text-ink-faint">→</span>
              <Badge tone="accent">4. Rerank passages</Badge>
              <span className="text-ink-faint">→</span>
              <Badge tone="accent">5. Evaluate evidence</Badge>
              <span className="text-ink-faint">→</span>
              <Badge tone="accent">6. Answer or refuse</Badge>
            </div>
          </Panel>

          {/* Role comparison */}
          <Panel>
            <PanelHeader
              title="Role-based access"
              description="Same corpus, different permissions"
            />
            <div className="flex flex-wrap gap-2">
              {ROLE_CARDS.map((r) => (
                <Badge key={r.role} tone={r.color as any} title={r.reach}>
                  {r.label}
                </Badge>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <main id="main" className="min-h-0 flex-1">
        <div className="mx-auto max-w-6xl h-full px-4 py-4 sm:px-6">
          <div className="h-full grid lg:grid-cols-4 gap-4">
            {/* Scenario sidebar */}
            <aside className="lg:col-span-1 space-y-4">
              <Panel>
                <PanelHeader
                  title="Try these questions"
                  description="Organized by what they demonstrate"
                />
                <div className="space-y-4">
                  {SCENARIO_QUESTIONS.map((section, sectionIndex) => (
                    <div key={section.phase} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                          {section.phase}
                        </span>
                        {section.restricted && (
                          <Badge tone="warning" className="text-[10px]">
                            Restricted
                          </Badge>
                        )}
                        {section.unsupported && (
                          <Badge tone="critical" className="text-[10px]">
                            Not in corpus
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted">{section.description}</p>
                      <div className="space-y-1.5">
                        {section.questions.map((q, qIndex) => (
                          <button
                            key={`${sectionIndex}-${qIndex}`}
                            type="button"
                            className="w-full rounded-md border border-edge bg-canvas-raised px-3 py-2 text-left text-sm text-ink-muted transition hover:border-accent/50 hover:text-ink"
                            onClick={() => {
                              const event = new CustomEvent('demo:ask', {
                                detail: { question: q },
                              });
                              window.dispatchEvent(event);
                            }}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* Pipeline status */}
              <Panel>
                <PanelHeader
                  title="Pipeline status"
                  description="Live metadata from the last answer"
                />
                <div id="pipeline-status" className="space-y-2 text-sm text-ink-muted font-mono">
                  {pipelineMeta ? (
                    <>
                      <div className="grid gap-1">
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Access levels:</span>
                          <span>{pipelineMeta.accessLevels.join(', ')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Vector candidates:</span>
                          <span>{pipelineMeta.retrieval.vectorCandidates}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Keyword candidates:</span>
                          <span>{pipelineMeta.retrieval.keywordCandidates}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">After access filter:</span>
                          <span>{pipelineMeta.retrieval.afterAccessFilter}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Reranked:</span>
                          <span>{pipelineMeta.retrieval.rerankedCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Retrieval latency:</span>
                          <span>{pipelineMeta.retrieval.latencyMs} ms</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Confidence:</span>
                          <span>
                            {(pipelineMeta.confidence.value * 100).toFixed(1)}% (
                            {pipelineMeta.confidence.label})
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Coverage:</span>
                          <span>{(pipelineMeta.confidence.coverage * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Grounding:</span>
                          <span className="capitalize">
                            {pipelineMeta.grounding.toLowerCase().replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Provider:</span>
                          <span>
                            {pipelineMeta.answer.provider} / {pipelineMeta.answer.model}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Citations:</span>
                          <span>{pipelineMeta.answer.citationCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-faint">Trace ID:</span>
                          <span className="font-mono text-[10px]">
                            {pipelineMeta.traceId.slice(0, 8)}…
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p>Ask a question to see pipeline metadata...</p>
                  )}
                </div>
              </Panel>
            </aside>

            {/* Chat panel */}
            <div className="lg:col-span-3 min-w-0">
              <ChatPanel
                mode="public"
                suggestions={SCENARIO_QUESTIONS.flatMap((s) => s.questions)}
                roleLabel="Public visitor"
                reachLabel="Reaches public documentation only"
                demoMode={demoMode}
                onPipelineMeta={setPipelineMeta}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
