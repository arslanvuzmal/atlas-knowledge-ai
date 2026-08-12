'use client';

import Link from 'next/link';
import { apiFetch } from '@/lib/ui';
import { useState } from 'react';
import { ChatPanel } from '@/components/chat/chat-panel';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { Badge, Panel, PanelHeader } from '@/components/ui/primitives';
import type { PipelineMetadata } from '@/components/chat/types';

const SCENARIO_QUESTIONS = [
  {
    phase: 'Public documentation',
    description: 'Answerable from public sources.',
    questions: [
      'What is the refund window for an annual subscription?',
      'How much does the Team plan cost per user?',
      'What encryption is used for data at rest?',
    ],
  },
  {
    phase: 'Access control challenge',
    description: 'Restricted — public visitors receive Unsupported/Restricted.',
    questions: ['How many days of annual leave do employees receive?'],
    restricted: true,
  },
  {
    phase: 'Unsupported / not in corpus',
    description: 'Demonstrates honest refusal when evidence is missing.',
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
  { role: 'PUBLIC', label: 'Public Visitor', reach: 'Public docs only', color: 'neutral' },
  { role: 'CUSTOMER', label: 'Customer', reach: 'Public + Customer', color: 'accent' },
  { role: 'EMPLOYEE', label: 'Employee', reach: 'Public + Customer + Employee', color: 'iris' },
  {
    role: 'MANAGER',
    label: 'Manager',
    reach: 'Public + Customer + Employee + Manager',
    color: 'warning',
  },
  { role: 'ADMIN', label: 'Admin', reach: 'All documents + configuration', color: 'good' },
];

export function DemoClient({ demoMode }: { demoMode: boolean }) {
  const [pipelineMeta, setPipelineMeta] = useState<PipelineMetadata | null>(null);
  const [activeRole, setActiveRole] = useState<RoleCard>(ROLE_CARDS[0]);
  const [chatKey, setChatKey] = useState('chat-PUBLIC');

  async function handleRoleChange(r: RoleCard) {
    setActiveRole(r);
    if (demoMode) {
      await apiFetch('/api/demo/session-role', {
        method: 'POST',
        body: JSON.stringify({ role: r.role }),
      });
      setChatKey(`chat-${r.role}-${Date.now()}`);
      setPipelineMeta(null);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink font-sans">
      <header className="shrink-0 border-b border-edge bg-canvas/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="rounded">
            <Wordmark showSubtitle />
          </Link>
          <div className="flex items-center gap-3">
            {demoMode ? <DemoBadge className="hidden sm:inline-flex" /> : null}
            <Link
              href="/login"
              className="rounded bg-accent px-3 py-1.5 font-mono text-xs font-bold text-ink-inverse transition hover:bg-accent-soft shadow-sm"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Role Access Ladder Switcher */}
      <div className="shrink-0 border-b border-edge bg-canvas-sunken px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] font-bold text-ink-faint uppercase">
              DEMO_ACCESS_SIMULATION:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_CARDS.map((r) => (
                <button
                  key={r.role}
                  type="button"
                  onClick={() => void handleRoleChange(r)}
                  className={`px-2.5 py-1 rounded font-mono text-xs font-semibold transition ${
                    activeRole.role === r.role
                      ? 'bg-accent text-ink-inverse shadow-sm'
                      : 'bg-canvas-raised border border-edge text-ink-muted hover:text-ink hover:border-accent/40'
                  }`}
                  title={r.reach}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <span className="font-mono text-[11px] text-teal font-semibold hidden lg:inline-block">
            REACH: {activeRole.reach}
          </span>
        </div>
      </div>

      <main id="main" className="min-h-0 flex-1">
        <div className="mx-auto max-w-7xl h-full p-4 sm:p-6">
          <div className="h-full grid lg:grid-cols-12 gap-4">
            {/* Scenario Sidebar (3 cols) */}
            <aside className="lg:col-span-3 space-y-4 overflow-y-auto pr-1">
              <Panel>
                <PanelHeader
                  title="Scenario Questions"
                  description="Test RBAC &amp; Epistemic Grounding"
                />
                <div className="p-3 space-y-4">
                  {SCENARIO_QUESTIONS.map((section, sectionIndex) => (
                    <div key={section.phase} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                          {section.phase}
                        </span>
                        {section.restricted && <Badge tone="warning">Restricted</Badge>}
                        {section.unsupported && <Badge tone="critical">No Source</Badge>}
                      </div>
                      <p className="text-[11px] text-ink-muted leading-tight font-sans">
                        {section.description}
                      </p>
                      <div className="space-y-1 pt-1">
                        {section.questions.map((q, qIndex) => (
                          <button
                            key={`${sectionIndex}-${qIndex}`}
                            type="button"
                            className="w-full rounded border border-edge bg-canvas-raised p-2 text-left text-xs text-ink-muted transition hover:border-accent hover:text-ink font-sans"
                            onClick={() => {
                              const event = new CustomEvent('demo:ask', {
                                detail: { question: q },
                              });
                              window.dispatchEvent(event);
                            }}
                          >
                            &ldquo;{q}&rdquo;
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* Pipeline Inspector */}
              <Panel>
                <PanelHeader title="Pipeline Metadata" description="Real-time Retrieval Trace" />
                <div className="p-3 space-y-2 font-mono text-[11px] text-ink-muted">
                  {pipelineMeta ? (
                    <div className="space-y-1.5 border-t border-edge-subtle pt-2">
                      <div className="flex justify-between">
                        <span className="text-ink-faint">Access Levels:</span>
                        <span className="text-accent">{pipelineMeta.accessLevels.join(', ')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-faint">Vector Matches:</span>
                        <span className="text-ink">{pipelineMeta.retrieval.vectorCandidates}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-faint">Keyword Matches:</span>
                        <span className="text-ink">{pipelineMeta.retrieval.keywordCandidates}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-faint">Latency:</span>
                        <span className="text-teal">{pipelineMeta.retrieval.latencyMs} ms</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-faint">Confidence:</span>
                        <span className="text-ink font-bold">
                          {typeof pipelineMeta.confidence.value === 'number'
                            ? `${(pipelineMeta.confidence.value * 100).toFixed(1)}%`
                            : 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-faint">Grounding:</span>
                        <span className="text-accent uppercase">
                          {pipelineMeta.grounding ?? 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-faint">Citations:</span>
                        <span className="text-ink">{pipelineMeta.answer.citationCount}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-ink-faint italic">
                      Execute a scenario question to inspect real pipeline telemetry...
                    </p>
                  )}
                </div>
              </Panel>
            </aside>

            {/* Chat Panel (9 cols) */}
            <div className="lg:col-span-9 min-w-0 h-full">
              <ChatPanel
                key={chatKey}
                mode="public"
                suggestions={SCENARIO_QUESTIONS.flatMap((s) => s.questions)}
                roleLabel={activeRole.label}
                reachLabel={activeRole.reach}
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
