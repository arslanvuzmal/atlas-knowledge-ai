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

/**
 * The conversational surface.
 *
 * Four states are represented explicitly rather than collapsed into a single
 * spinner, because they mean different things to the user: retrieving,
 * answering, answered-but-unsupported, and failed. The unsupported state is a
 * first-class outcome with related sources and a route to a human, not an
 * error.
 */

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
      // The two phases are genuinely sequential on the server; the timer only
      // decides when the label switches, it does not fake progress.
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

  // Listen for demo page questions
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
    // Enter sends, Shift+Enter inserts a newline: the convention users expect.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  const busy = phase !== 'idle';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3 sm:px-6">
        <Badge tone="accent">{roleLabel}</Badge>
        <span className="text-xs text-ink-faint">{reachLabel}</span>
        {demoMode ? (
          <Badge tone="iris" className="ml-auto">
            Demo providers
          </Badge>
        ) : null}
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
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
                conversationId={conversationId}
              />
            ),
          )}

          {busy ? <PendingTurn phase={phase} /> : null}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-edge bg-canvas-raised px-4 py-4 sm:px-6"
      >
        <div className="mx-auto max-w-3xl">
          <label htmlFor="chat-input" className="sr-only">
            Ask a question
          </label>
          <div className="flex items-end gap-2 rounded-panel border border-edge bg-canvas-sunken p-2 focus-within:border-accent">
            <textarea
              id="chat-input"
              ref={textareaRef}
              rows={1}
              value={input}
              maxLength={MAX_LENGTH}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={busy}
              placeholder="Ask about the approved knowledge base…"
              className="max-h-40 min-h-[40px] flex-1 resize-y bg-transparent px-2 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || input.trim().length === 0}
              className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Ask'}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-faint">
            <span>Enter to send · Shift+Enter for a new line</span>
            <span className="tabular-nums">
              {input.length}/{MAX_LENGTH}
            </span>
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-xs text-status-critical">
              {error}
            </p>
          ) : null}
        </div>
      </form>

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
    <div className="animate-fade-up">
      <h2 className="text-lg font-semibold tracking-tight text-ink">
        {mode === 'public'
          ? 'Ask the Northstar Cloud knowledge base'
          : 'What would you like to know?'}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
        Answers come only from approved sources you are permitted to see, and every claim carries a
        citation. When the sources do not cover your question, Atlas will say so rather than guess.
      </p>

      <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Try one of these
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="rounded-md border border-edge bg-canvas-raised px-3.5 py-2.5 text-left text-sm text-ink-muted transition hover:border-accent/50 hover:text-ink"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserTurn({ turn }: { turn: ChatTurn }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-panel rounded-br-sm bg-accent-wash px-4 py-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{turn.content}</p>
      </div>
    </div>
  );
}

function PendingTurn({ phase }: { phase: 'retrieving' | 'answering' }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-muted" role="status">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent"
            style={{ animationDelay: `${index * 160}ms` }}
          />
        ))}
      </span>
      {phase === 'retrieving' ? 'Searching approved sources…' : 'Composing a grounded answer…'}
    </div>
  );
}

/** Renders the answer, turning [n] markers into visible citation references. */
function AnswerBody({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/);

  return (
    <div className="prose-answer">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          {paragraph.split(/(\[\d{1,2}\])/g).map((part, partIndex) => {
            const marker = /^\[(\d{1,2})\]$/.exec(part);
            if (!marker) return <span key={partIndex}>{part}</span>;
            return (
              <sup
                key={partIndex}
                className="mx-0.5 rounded bg-accent-wash px-1 py-0.5 font-mono text-[10px] font-semibold text-accent-soft"
              >
                {marker[1]}
              </sup>
            );
          })}
        </p>
      ))}
    </div>
  );
}

function EvidencePanel({ evidence }: { evidence: EvidencePacket }) {
  const conflict = evidence.conflictDetected;
  const conflictDocs = evidence.conflictingDocuments;

  return (
    <div className="mt-5 rounded-md border border-edge bg-canvas-sunken p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Evidence
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="rounded-full bg-accent-wash px-2 py-0.5 font-mono text-[11px] text-accent-soft">
              {evidence.confidenceLabel}
            </span>
            <span className="text-ink-faint">·</span>
            <span>
              {evidence.supportingPassages} passage{evidence.supportingPassages !== 1 ? 's' : ''}
            </span>
            <span className="text-ink-faint">·</span>
            <span>
              {evidence.supportingDocuments} document{evidence.supportingDocuments !== 1 ? 's' : ''}
            </span>
            <span className="text-ink-faint">·</span>
            <span>{Math.round(evidence.coverage * 100)}% question coverage</span>
          </div>
          {conflict && conflictDocs.length > 0 ? (
            <div className="mt-3 p-3 rounded-md border border-status-warning/40 bg-status-warning/10">
              <p className="text-sm font-medium text-status-warning flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 2a8 8 0 100 16 8 8 0 000-16zM10 6v6m0 4v.01"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Conflicting approved sources detected
              </p>
              <p className="mt-1.5 text-xs text-ink-muted">
                Multiple approved documents appear to contain contradictory information on this
                topic. A human should review before relying on this answer.
              </p>
              <ul className="mt-2 space-y-1">
                {conflictDocs.map((doc, index) => (
                  <li
                    key={doc.documentId}
                    className="text-xs text-ink-muted flex items-start gap-1.5"
                  >
                    <span className="font-mono text-status-warning">{index + 1}.</span>
                    <span className="font-medium">{doc.title}</span>
                    <span className="text-ink-faint">—</span>
                    <span className="line-clamp-1">{doc.excerpt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AssistantTurn({
  turn,
  onOpenCitation,
  conversationId,
}: {
  turn: ChatTurn;
  onOpenCitation: (citation: Citation) => void;
  conversationId: string | null;
}) {
  if (turn.errored) {
    return (
      <div className="rounded-panel border border-status-critical/40 bg-status-critical/10 px-4 py-3">
        <p className="text-sm text-status-critical">{turn.content}</p>
      </div>
    );
  }

  const meta = turn.grounding ? GROUNDING_META[turn.grounding] : null;
  const unsupported = turn.grounding === 'UNSUPPORTED';

  return (
    <article className="animate-fade-up rounded-panel border border-edge bg-canvas-raised">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge-subtle px-4 py-2.5">
        {meta ? (
          <Badge tone={meta.tone} title={meta.description}>
            {meta.label}
          </Badge>
        ) : null}
        {typeof turn.confidence === 'number' ? (
          <ConfidenceMeter value={turn.confidence} threshold={0.65} compact />
        ) : null}
        {turn.isDemo ? (
          <span
            className="ml-auto text-[11px] text-ink-faint"
            title={`${turn.provider}/${turn.model}`}
          >
            Demo generator
          </span>
        ) : null}
      </div>

      <div className="px-4 py-4">
        <AnswerBody content={turn.content} />

        {turn.evidence && <EvidencePanel evidence={turn.evidence} />}

        {turn.citations && turn.citations.length > 0 ? (
          <div className="mt-5">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Sources
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {turn.citations.map((citation) => (
                <CitationCard key={citation.ordinal} citation={citation} onOpen={onOpenCitation} />
              ))}
            </div>
          </div>
        ) : null}

        {unsupported && turn.relatedSources && turn.relatedSources.length > 0 ? (
          <div className="mt-5 rounded-md border border-edge bg-canvas-sunken p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Related approved sources
            </p>
            <ul className="mt-2 space-y-1 text-sm text-ink-muted">
              {turn.relatedSources.map((source) => (
                <li key={source.documentId}>
                  {source.title}
                  {source.sectionTitle ? (
                    <span className="text-ink-faint"> · {source.sectionTitle}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={cn('mt-4 flex flex-wrap items-start justify-between gap-3')}>
          <EscalationButton conversationId={conversationId} />
        </div>

        <FeedbackControls messageId={turn.id} answerText={turn.content} />
      </div>
    </article>
  );
}
