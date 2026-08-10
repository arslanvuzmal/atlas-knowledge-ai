'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { apiFetch, cn } from '@/lib/ui';
import { Badge } from '@/components/ui/primitives';
import { ConfidenceMeter } from '@/components/dashboard/charts';
import { CitationCard } from './citation-card';
import { SourceDrawer } from './source-drawer';
import { EscalationButton, FeedbackControls } from './feedback-controls';
import {
  GROUNDING_META,
  type ChatResponse,
  type ChatTurn,
  type Citation,
  type EvidencePacket,
  type PipelineMetadata,
} from './types';

interface ChatPanelProps {
  mode: 'authenticated' | 'public';
  initialConversationId?: string | null;
  initialTurns?: ChatTurn[];
  suggestions: string[];
  roleLabel: string;
  reachLabel: string;
  demoMode: boolean;
  onPipelineMeta?: (meta: PipelineMetadata) => void;
}

const MAX_LENGTH = 2000;

export function ChatPanel({
  mode,
  initialConversationId = null,
  initialTurns = [],
  suggestions,
  roleLabel,
  reachLabel,
  demoMode,
  onPipelineMeta,
}: ChatPanelProps) {
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<'idle' | 'retrieving' | 'answering'>('idle');
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const [hoveredCitationOrdinal, setHoveredCitationOrdinal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, phase]);

  useEffect(
    () => () => {
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
    },
    [],
  );

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (trimmed.length === 0 || phase !== 'idle') return;

      setError(null);
      setInput('');

      const userTurn: ChatTurn = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setTurns((current) => [...current, userTurn]);

      setPhase('retrieving');
      phaseTimer.current = setTimeout(() => setPhase('answering'), 550);

      const result = await apiFetch<ChatResponse>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ question: trimmed, conversationId }),
      });

      if (phaseTimer.current) clearTimeout(phaseTimer.current);
      setPhase('idle');

      if (!result.ok) {
        setError(result.error);
        setTurns((current) => [
          ...current,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: result.error,
            errored: true,
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      const data = result.data;
      setConversationId(data.conversationId);
      if (data.pipelineMeta) {
        onPipelineMeta?.(data.pipelineMeta);
      }
      setTurns((current) => [
        ...current,
        {
          id: data.messageId,
          role: 'assistant',
          content: data.answer,
          grounding: data.grounding,
          confidence: data.confidence,
          citations: data.citations,
          relatedSources: data.relatedSources,
          escalationId: data.escalationId,
          provider: data.provider,
          model: data.model,
          isDemo: data.isDemo,
          createdAt: new Date().toISOString(),
          evidence: data.evidence,
          pipelineMeta: data.pipelineMeta,
        },
      ]);
    },
    [conversationId, phase, onPipelineMeta],
  );

  useEffect(() => {
    function handleDemoAsk(event: CustomEvent<{ question: string }>) {
      void send(event.detail.question);
    }
    window.addEventListener('demo:ask', handleDemoAsk as EventListener);
    return () => window.removeEventListener('demo:ask', handleDemoAsk as EventListener);
  }, [send]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  const busy = phase !== 'idle';
  const latestAssistantTurn = [...turns]
    .reverse()
    .find((t) => t.role === 'assistant' && !t.errored);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {/* Top Scope Utility Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-edge bg-canvas-sunken/60 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2">
          <Badge tone="accent">{roleLabel}</Badge>
          <span className="font-mono text-xs text-ink-faint">{reachLabel}</span>
        </div>
        <Badge tone="iris">
          {latestAssistantTurn?.provider
            ? `${latestAssistantTurn.provider.toUpperCase()} (${latestAssistantTurn.model ?? ''})`
            : demoMode
              ? 'DEMO DATASET'
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

          {/* Fixed Question Input Bar */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-edge bg-canvas-raised px-4 py-3 sm:px-6"
          >
            <div className="mx-auto max-w-2xl">
              <label htmlFor="chat-input" className="sr-only">
                Ask a question about your approved knowledge
              </label>
              <div className="flex items-end gap-2 rounded border border-edge bg-canvas-sunken p-2 focus-within:border-accent">
                <textarea
                  id="chat-input"
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  maxLength={MAX_LENGTH}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={busy}
                  placeholder="Ask a question about your approved knowledge…"
                  className="max-h-36 min-h-[36px] flex-1 resize-y bg-transparent px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60 font-sans"
                />
                <button
                  type="submit"
                  disabled={busy || input.trim().length === 0}
                  className="shrink-0 rounded bg-accent px-3.5 py-1.5 font-mono text-xs font-bold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-50"
                >
                  {busy ? 'Working…' : 'Ask'}
                </button>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] text-ink-faint">
                <span>Enter to send · Shift+Enter for newline</span>
                <span className="tabular-nums">
                  {input.length}/{MAX_LENGTH}
                </span>
              </div>

              {error ? (
                <p role="alert" className="mt-1.5 font-mono text-xs text-status-critical">
                  {error}
                </p>
              ) : null}
            </div>
          </form>
        </div>

        {/* Right Column (38% Evidence Inspector Panel) */}
        <aside className="w-full lg:w-[400px] shrink-0 bg-canvas-raised flex flex-col min-h-0 overflow-y-auto border-t lg:border-t-0 border-edge p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-edge pb-3">
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
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[10.5px] font-mono font-bold uppercase tracking-wider text-ink-faint">
                <span>RETRIEVED CITATIONS</span>
                <span>HOVER TO LINK</span>
              </div>
              <div className="space-y-2">
                {latestAssistantTurn.citations.map((citation) => (
                  <CitationCard
                    key={citation.ordinal}
                    citation={citation}
                    onOpen={setOpenCitation}
                    highlighted={hoveredCitationOrdinal === citation.ordinal}
                    onHover={setHoveredCitationOrdinal}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {latestAssistantTurn?.relatedSources && latestAssistantTurn.relatedSources.length > 0 ? (
            <div className="p-3 rounded border border-edge bg-canvas-sunken space-y-2">
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-ink-faint block">
                RELATED APPROVED SOURCES
              </span>
              <ul className="space-y-1.5 text-xs text-ink-muted">
                {latestAssistantTurn.relatedSources.map((s) => (
                  <li
                    key={s.documentId}
                    className="flex items-center justify-between truncate border-b border-edge-subtle pb-1"
                  >
                    <span className="truncate text-ink font-medium">{s.title}</span>
                    {s.sectionTitle ? (
                      <span className="font-mono text-[10px] text-ink-faint shrink-0 ml-2">
                        {s.sectionTitle}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
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
  content: string;
  hoveredOrdinal: number | null;
  onHoverOrdinal: (ordinal: number | null) => void;
}) {
  const paragraphs = content.split(/\n{2,}/);

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
      <div className="rounded border border-status-critical/40 bg-status-critical/10 p-3 font-mono text-xs text-status-critical">
        {turn.content}
      </div>
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
            CITED EVIDENCE SOURCES
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
