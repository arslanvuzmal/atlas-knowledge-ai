'use client';

import { useState, useRef, useEffect } from 'react';
import { Badge, StatusDot } from '@/components/ui/primitives';
import { cn } from '@/lib/ui';
import type { ChatTurn, Citation, EvidencePacket } from './types';
import { GROUNDING_META } from './types';
import { ConfidenceMeter } from '@/components/dashboard/charts';
import { CitationCard } from './citation-card';
import { SourceDrawer } from './source-drawer';
import { FeedbackControls, EscalationButton } from './feedback-controls';

export interface ChatPanelProps {
  initialConversationId?: string | null;
  initialTurnHistory?: ChatTurn[];
  initialTurns?: ChatTurn[];
  mode?: 'authenticated' | 'public';
  suggestedQuestions?: string[];
  suggestions?: string[];
  roleLabel?: string;
  reachLabel?: string;
  demoMode?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPipelineMeta?: (meta: any) => void;
}

export function ChatPanel({
  initialConversationId = null,
  initialTurnHistory,
  initialTurns,
  mode = 'authenticated',
  suggestedQuestions,
  suggestions: suggestionsProp,
  roleLabel,
  reachLabel,
  demoMode,
}: ChatPanelProps) {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns || initialTurnHistory || []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'retrieving' | 'answering'>('retrieving');
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const [hoveredCitationOrdinal, setHoveredCitationOrdinal] = useState<number | null>(null);

  const endRef = useRef<HTMLDivElement>(null);

  const suggestions = suggestionsProp ||
    suggestedQuestions || [
      'What is the refund window for an annual subscription?',
      'Does the refund policy apply to monthly plans too?',
      'What security and data privacy controls do you provide?',
      'How do I request a custom SOC 2 compliance report?',
    ];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  const send = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || busy) return;

    const userTurn: ChatTurn = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
    };

    setTurns((prev) => [...prev, userTurn]);
    setInput('');
    setBusy(true);
    setPhase('retrieving');

    try {
      setTimeout(() => setPhase('answering'), 300);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          conversationId,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || 'Failed to generate answer.');
      }

      if (data.conversationId) {
        setConversationId(data.conversationId);
      }

      const answerText =
        typeof data.answer === 'string'
          ? data.answer
          : typeof data.answer?.text === 'string'
            ? data.answer.text
            : '';

      const assistantTurn: ChatTurn = {
        id: data.messageId || `ast_${Date.now()}`,
        role: 'assistant',
        content: answerText,
        confidence: data.confidence ?? data.answer?.confidence,
        grounding: data.grounding ?? data.answer?.grounding,
        citations: data.citations ?? data.answer?.citations,
        evidence: data.evidence ?? data.answer?.evidence,
        relatedSources: data.relatedSources,
        createdAt: new Date().toISOString(),
      };

      setTurns((prev) => [...prev, assistantTurn]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTurns((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: `Unable to process question: ${message}`,
          errored: true,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const latestAssistantTurn = turns.filter((t) => t.role === 'assistant' && !t.errored).pop();

  return (
    <div className="flex h-full flex-col bg-canvas text-ink font-sans">
      {/* Dynamic System Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge bg-canvas-sunken/60 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <StatusDot tone="good" label="RAG Engine Active" />
          <span className="text-ink-faint">|</span>
          <span className="text-ink-muted text-[11px]">
            {roleLabel ? `${roleLabel} · ` : ''}
            {reachLabel ? `${reachLabel} · ` : ''}
            Role-based vector &amp; keyword hybrid retrieval with epistemic grounding
          </span>
        </div>
        <Badge tone="neutral">
          {mode === 'public'
            ? 'PUBLIC CORPUS DEMO'
            : conversationId
              ? `SESSION: ${conversationId.slice(0, 12)}…`
              : demoMode
                ? 'DEMO_MODE'
                : 'LIVE PIPELINE'}
        </Badge>
      </div>

      {/* 62 / 38 Desktop Split Workspace */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row overflow-hidden">
        {/* Left Column (62% Answer Workspace) */}
        <div className="flex flex-1 min-h-0 flex-col border-b lg:border-b-0 lg:border-r border-edge">
          <div
            className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
            role="log"
            aria-live="polite"
            aria-label="Conversation"
          >
            <div className="mx-auto flex max-w-2xl flex-col gap-6">
              {turns.length === 0 ? (
                <EmptyConversation
                  mode={mode}
                  suggestions={suggestions}
                  onPick={(question) => void send(question)}
                />
              ) : null}

              {turns.map((turn) =>
                turn.role === 'user' ? (
                  <UserTurn key={turn.id} turn={turn} />
                ) : (
                  <AssistantTurn
                    key={turn.id}
                    turn={turn}
                    onOpenCitation={setOpenCitation}
                    hoveredCitationOrdinal={hoveredCitationOrdinal}
                    onHoverCitation={setHoveredCitationOrdinal}
                    conversationId={conversationId}
                    onAskRelated={(q) => void send(q)}
                  />
                ),
              )}

              {busy ? <PendingTurn phase={phase} /> : null}
              <div ref={endRef} />
            </div>
          </div>

          {/* Chat Input Bar */}
          <div className="border-t border-edge bg-canvas-sunken p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="mx-auto flex max-w-2xl gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a factual question about product, security, or enterprise policy..."
                disabled={busy}
                aria-label="Ask a question"
                className="flex-1 rounded border border-edge bg-canvas px-3.5 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 font-sans"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40"
              >
                Ask
              </button>
            </form>
          </div>
        </div>

        {/* Right Column (38% Evidence Workspace) */}
        <div className="hidden lg:flex lg:w-[38%] min-h-0 flex-col overflow-y-auto bg-canvas-sunken/30 p-4 border-t lg:border-t-0">
          <div className="flex items-center justify-between border-b border-edge pb-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-teal animate-pulse" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
                EVIDENCE_PANEL
              </h3>
            </div>
            {latestAssistantTurn?.citations?.length ? (
              <span className="font-mono text-[10.5px] text-teal font-semibold">
                {latestAssistantTurn.citations.length} Sources Matched
              </span>
            ) : (
              <span className="font-mono text-[10.5px] text-ink-faint">No Active Query</span>
            )}
          </div>

          {latestAssistantTurn?.evidence ? (
            <EvidenceSummaryPanel evidence={latestAssistantTurn.evidence} />
          ) : (
            <div className="p-4 rounded border border-edge-subtle bg-canvas-sunken/40 text-center font-mono text-xs text-ink-faint">
              Ask a question to see real-time retrieved evidence passages &amp; citations.
            </div>
          )}

          {latestAssistantTurn?.citations && latestAssistantTurn.citations.length > 0 ? (
            <div className="mt-4 space-y-2">
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-ink-faint block">
                Sources ({latestAssistantTurn.citations.length})
              </span>
              <div className="space-y-2">
                {latestAssistantTurn.citations.map((c) => (
                  <CitationCard
                    key={c.ordinal}
                    citation={c}
                    onOpen={setOpenCitation}
                    highlighted={hoveredCitationOrdinal === c.ordinal}
                    onHover={setHoveredCitationOrdinal}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <SourceDrawer citation={openCitation} onClose={() => setOpenCitation(null)} />
    </div>
  );
}

function EmptyConversation({
  mode,
  suggestions,
  onPick,
}: {
  mode: 'authenticated' | 'public';
  suggestions: string[];
  onPick: (question: string) => void;
}) {
  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h2 className="text-base font-bold text-ink font-sans">
          {mode === 'public'
            ? 'Ask the Northstar Cloud Knowledge Base'
            : 'Grounded Enterprise Knowledge Search'}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Answers are strictly derived from approved sources permitted under your role. Every claim
          carries an interactive source citation. When evidence is insufficient, Atlas refuses to
          guess.
        </p>
      </div>

      <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-ink-faint block">
        SUGGESTED VERIFIED QUESTIONS
      </span>
      <div className="grid gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="rounded border border-edge bg-canvas-raised p-3 text-left text-xs text-ink-muted transition hover:border-accent hover:text-ink font-sans"
          >
            &ldquo;{suggestion}&rdquo;
          </button>
        ))}
      </div>
    </div>
  );
}

function UserTurn({ turn }: { turn: ChatTurn }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded bg-canvas-overlay border border-edge-strong px-4 py-2.5">
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink font-sans">
          {turn.content}
        </p>
      </div>
    </div>
  );
}

function PendingTurn({ phase }: { phase: 'retrieving' | 'answering' }) {
  return (
    <div
      className="flex items-center gap-3 text-xs font-mono text-ink-muted p-3 bg-canvas-sunken rounded border border-edge"
      role="status"
    >
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
            style={{ animationDelay: `${index * 160}ms` }}
          />
        ))}
      </span>
      {phase === 'retrieving' ? 'RETRIEVING_PERMITTED_PASSAGES...' : 'COMPOSING_GROUNDED_ANSWER...'}
    </div>
  );
}

function AnswerBody({
  content,
  hoveredOrdinal,
  onHoverOrdinal,
}: {
  content?: string;
  hoveredOrdinal: number | null;
  onHoverOrdinal: (ordinal: number | null) => void;
}) {
  const safeContent = content ?? '';
  const paragraphs = safeContent.split(/\n{2,}/);

  return (
    <div className="prose-answer">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          {paragraph.split(/(\[\d{1,2}\])/g).map((part, partIndex) => {
            const marker = /^\[(\d{1,2})\]$/.exec(part);
            if (!marker) return <span key={partIndex}>{part}</span>;
            const ordinal = parseInt(marker[1], 10);
            const isHovered = hoveredOrdinal === ordinal;
            return (
              <sup
                key={partIndex}
                onMouseEnter={() => onHoverOrdinal(ordinal)}
                onMouseLeave={() => onHoverOrdinal(null)}
                className={cn(
                  'mx-0.5 cursor-pointer rounded px-1 py-0.5 font-mono text-[10px] font-bold transition-all duration-150',
                  isHovered
                    ? 'bg-teal text-ink-inverse scale-110 shadow-sm'
                    : 'bg-accent-wash text-accent-soft border border-accent/30 hover:border-accent',
                )}
              >
                [{ordinal}]
              </sup>
            );
          })}
        </p>
      ))}
    </div>
  );
}

function EvidenceSummaryPanel({ evidence }: { evidence: EvidencePacket }) {
  const conflict = evidence.conflictDetected;
  const conflictDocs = evidence.conflictingDocuments;

  return (
    <div className="rounded border border-edge bg-canvas-sunken p-3 space-y-2 font-mono text-xs">
      <div className="flex items-center justify-between border-b border-edge pb-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-faint">
          RETRIEVAL METRICS
        </span>
        <span className="text-teal font-semibold text-[11px]">{evidence.confidenceLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="p-1.5 bg-canvas-raised rounded border border-edge-subtle">
          <div className="text-[9.5px] text-ink-faint uppercase">Passages</div>
          <div className="font-bold text-ink">{evidence.supportingPassages}</div>
        </div>
        <div className="p-1.5 bg-canvas-raised rounded border border-edge-subtle">
          <div className="text-[9.5px] text-ink-faint uppercase">Coverage</div>
          <div className="font-bold text-ink">{Math.round(evidence.coverage * 100)}%</div>
        </div>
      </div>
      {conflict && conflictDocs.length > 0 ? (
        <div className="mt-2 p-2.5 rounded border border-status-warning/40 bg-status-warning/10 space-y-1">
          <p className="text-xs font-bold text-status-warning flex items-center gap-1.5">
            ⚠️ Material Source Conflict Detected
          </p>
          <p className="text-[11px] text-ink-muted leading-relaxed font-sans">
            Multiple approved documents contain contradictory claims on this topic.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function AssistantTurn({
  turn,
  onOpenCitation,
  hoveredCitationOrdinal,
  onHoverCitation,
  conversationId,
  onAskRelated,
}: {
  turn: ChatTurn;
  onOpenCitation: (citation: Citation) => void;
  hoveredCitationOrdinal: number | null;
  onHoverCitation: (ordinal: number | null) => void;
  conversationId: string | null;
  onAskRelated?: (question: string) => void;
}) {
  if (turn.errored) {
    return (
      <article className="rounded border border-status-critical/40 bg-status-critical/10 p-3 font-mono text-xs text-status-critical">
        {turn.content}
      </article>
    );
  }

  const meta = turn.grounding ? GROUNDING_META[turn.grounding] : null;
  const unsupported = turn.grounding === 'UNSUPPORTED';

  return (
    <article className="animate-fade-up rounded border border-edge bg-canvas-raised space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge pb-2.5">
        <div className="flex items-center gap-2">
          {meta ? (
            <Badge tone={meta.tone} title={meta.description}>
              {meta.label}
            </Badge>
          ) : null}
          {typeof turn.confidence === 'number' ? (
            <ConfidenceMeter value={turn.confidence} threshold={0.65} compact />
          ) : null}
        </div>
        {turn.isDemo ? (
          <span className="font-mono text-[10px] text-ink-faint uppercase">DEMO_GENERATOR</span>
        ) : null}
      </div>

      <AnswerBody
        content={turn.content}
        hoveredOrdinal={hoveredCitationOrdinal}
        onHoverOrdinal={onHoverCitation}
      />

      {turn.citations && turn.citations.length > 0 ? (
        <div className="pt-2 border-t border-edge space-y-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-faint block">
            Sources
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {turn.citations.map((c) => (
              <CitationCard
                key={c.ordinal}
                citation={c}
                onOpen={onOpenCitation}
                compact
                highlighted={hoveredCitationOrdinal === c.ordinal}
                onHover={onHoverCitation}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Restrained Epistemic Action Bar for Unsupported Queries */}
      {unsupported ? (
        <div className="p-3 rounded border border-amber/30 bg-amber-wash/10 space-y-2 font-mono text-xs">
          <div className="flex items-center gap-1.5 font-bold text-amber">
            <span>NO APPROVED EVIDENCE FOUND</span>
          </div>
          <p className="text-[11px] font-sans text-ink-muted leading-relaxed">
            Atlas could not find enough approved evidence to answer this reliably. Select an action
            below:
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() =>
                onAskRelated?.('What are the official policies related to this request?')
              }
              className="px-2.5 py-1 text-[11px] rounded border border-edge bg-canvas-sunken text-ink hover:border-accent hover:text-accent transition"
            >
              Refine Question
            </button>
            <EscalationButton conversationId={conversationId} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-3">
          <EscalationButton conversationId={conversationId} />
          <FeedbackControls messageId={turn.id} answerText={turn.content} />
        </div>
      )}
    </article>
  );
}
