'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Panel, StatusDot } from '@/components/ui/primitives';

export interface InboxConversation {
  id: string;
  title: string;
  updatedAt: string;
  status: string;
  contact?: {
    id: string;
    displayName: string;
    primaryEmail: string | null;
    leadScore: number;
    leadTier: string;
    scoreFactors?: { factor: string; points: number }[];
    company?: { name: string; domain: string | null } | null;
    intelligence?: {
      summary: string | null;
      primaryIntent: string | null;
      productInterest: string | null;
      urgency: string | null;
      seatRequirement: number | null;
      timeline: string | null;
      requestedFollowUp: boolean;
      explicitRequirements: string[];
    } | null;
  } | null;
  messages: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
    citations?: { documentId: string; excerpt: string }[];
  }[];
  tasks?: { id: string; title: string; dueAt: string | null; status: string }[];
  deals?: { id: string; name: string; amount: number | null; stageName: string }[];
}

export function InboxWorkspace({ conversations }: { conversations: InboxConversation[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialConvId = searchParams.get('conversation');

  const [selectedId, setSelectedId] = useState<string>(() => {
    if (initialConvId && conversations.some((c) => c.id === initialConvId)) {
      return initialConvId;
    }
    return conversations[0]?.id ?? '';
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'needs_human' | 'high_intent'>('all');

  const [composerMode, setComposerMode] = useState<'reply' | 'note'>('reply');
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiMetadata, setAiMetadata] = useState<{
    confidence?: number;
    grounding?: string;
    citations?: { title: string; excerpt: string; accessLevel: string }[];
  } | null>(null);

  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Sync selection if URL search parameter changes
  useEffect(() => {
    const paramId = searchParams.get('conversation');
    if (paramId && conversations.some((c) => c.id === paramId)) {
      setSelectedId(paramId);
    }
  }, [searchParams, conversations]);

  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0];
  const contact = selected?.contact;
  const intel = contact?.intelligence;

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    // 1. Text Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const nameMatch = c.contact?.displayName.toLowerCase().includes(q);
      const emailMatch = c.contact?.primaryEmail?.toLowerCase().includes(q);
      const companyMatch = c.contact?.company?.name.toLowerCase().includes(q);
      const titleMatch = c.title.toLowerCase().includes(q);
      const msgMatch = c.messages.some((m) => m.content.toLowerCase().includes(q));

      if (!nameMatch && !emailMatch && !companyMatch && !titleMatch && !msgMatch) {
        return false;
      }
    }

    // 2. Tab Filter
    if (filterTab === 'needs_human') {
      return c.status === 'NEEDS_HUMAN' || c.status === 'ESCALATED';
    }
    if (filterTab === 'high_intent') {
      return (
        (c.contact?.leadScore ?? 0) >= 70 ||
        (c.contact?.intelligence?.primaryIntent ?? '').toLowerCase().includes('purchase') ||
        (c.contact?.intelligence?.primaryIntent ?? '').toLowerCase().includes('evalu')
      );
    }

    return true;
  });

  const selectConversation = (id: string) => {
    setSelectedId(id);
    setAiMetadata(null);
    setStatusMessage(null);
    router.replace(`/dashboard/inbox?conversation=${id}`, { scroll: false });
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selected || isSending) return;

    setIsSending(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/conversations/${selected.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: replyText.trim(),
          mode: composerMode,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to post response.');
      }

      setReplyText('');
      setAiMetadata(null);
      setStatusMessage({
        type: 'success',
        text:
          composerMode === 'reply' ? 'Outbound reply sent successfully.' : 'Internal note posted.',
      });

      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsSending(false);
    }
  };

  const handleAiAction = async (action: 'find' | 'clarify' | 'shorten') => {
    if (!selected || isAiLoading) return;

    setIsAiLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/conversations/${selected.id}/ai-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          currentDraft: replyText,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to generate AI draft.');
      }

      if (data.draftText) {
        setReplyText(data.draftText);
      }

      if (action === 'find') {
        setAiMetadata({
          confidence: data.confidence,
          grounding: data.grounding,
          citations: data.citations,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* LEFT COLUMN: Conversation List & Filters (3 Cols) */}
      <Panel className="lg:col-span-3 flex flex-col h-full overflow-hidden p-0 border border-edge">
        <div className="p-3 border-b border-edge bg-canvas-sunken space-y-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, email, company, message..."
            className="w-full px-3 py-1.5 text-xs rounded border border-edge bg-canvas text-ink focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setFilterTab('all')}
              className={`text-[11px] font-medium transition ${
                filterTab === 'all' ? 'text-accent font-bold' : 'text-ink-faint hover:text-ink'
              }`}
            >
              All ({conversations.length})
            </button>
            <button
              onClick={() => setFilterTab('needs_human')}
              className={`text-[11px] font-medium transition ${
                filterTab === 'needs_human'
                  ? 'text-accent font-bold'
                  : 'text-ink-faint hover:text-ink'
              }`}
            >
              Needs Human
            </button>
            <button
              onClick={() => setFilterTab('high_intent')}
              className={`text-[11px] font-medium transition ${
                filterTab === 'high_intent'
                  ? 'text-accent font-bold'
                  : 'text-ink-faint hover:text-ink'
              }`}
            >
              High Intent
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-edge-subtle">
          {filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-xs text-ink-faint">
              No conversations match criteria
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = c.id === selectedId;
              const lastMsg = c.messages[c.messages.length - 1];
              return (
                <button
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  className={`w-full text-left p-3.5 transition-colors ${
                    isSelected
                      ? 'bg-canvas-overlay border-l-2 border-accent'
                      : 'hover:bg-canvas-sunken'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-ink truncate">
                      {c.contact?.displayName || 'Anonymous Visitor'}
                    </span>
                    <span className="text-[10px] text-ink-faint shrink-0">
                      {new Date(c.updatedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="text-[11px] text-ink-muted truncate mb-2">
                    {c.contact?.company?.name ? `${c.contact.company.name} · ` : ''}
                    {lastMsg?.content || c.title}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.contact?.leadScore ? (
                      <Badge tone={c.contact.leadScore >= 70 ? 'good' : 'neutral'}>
                        {c.contact.leadScore} pts
                      </Badge>
                    ) : null}
                    {c.contact?.intelligence?.primaryIntent ? (
                      <Badge tone="accent">{c.contact.intelligence.primaryIntent}</Badge>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </Panel>

      {/* CENTER COLUMN: Thread & Composer (5 Cols) */}
      <Panel className="lg:col-span-5 flex flex-col h-full overflow-hidden p-0 border border-edge">
        {selected ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-edge flex items-center justify-between bg-canvas-overlay">
              <div>
                <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                  {contact?.displayName || 'Anonymous Visitor'}
                  {contact?.company?.name ? (
                    <span className="text-xs font-normal text-ink-muted">
                      at {contact.company.name}
                    </span>
                  ) : null}
                </h2>
                <p className="text-[11px] text-ink-faint">
                  {contact?.primaryEmail || 'Session: ' + selected.id}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <StatusDot
                  tone={selected.status === 'ACTIVE' ? 'good' : 'warning'}
                  label={selected.status}
                />
              </div>
            </div>

            {/* Message Thread */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-canvas-sunken/40">
              {selected.messages.map((m) => {
                const isInternalNote =
                  m.role === 'SYSTEM' || m.content.startsWith('[Internal Note]');
                const displayContent = m.content.replace(/^\[Internal Note\]\s*/, '');

                if (isInternalNote) {
                  return (
                    <div
                      key={m.id}
                      className="p-2.5 rounded bg-status-warning/10 border border-status-warning/30 text-xs text-ink"
                    >
                      <div className="flex justify-between text-[10px] text-status-warning font-semibold mb-1">
                        <span>Internal Note</span>
                        <span>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {displayContent}
                    </div>
                  );
                }

                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.role === 'USER' ? 'items-start' : 'items-end'}`}
                  >
                    <div
                      className={`max-w-[88%] p-3 rounded-lg text-xs leading-relaxed ${
                        m.role === 'USER'
                          ? 'bg-canvas-overlay border border-edge text-ink'
                          : 'bg-accent/10 border border-accent/30 text-ink'
                      }`}
                    >
                      <div className="text-[10px] font-semibold text-ink-faint mb-1">
                        {m.role === 'USER'
                          ? contact?.displayName || 'Customer'
                          : 'Atlas Assistant / Agent'}
                      </div>
                      {displayContent}

                      {m.citations && m.citations.length > 0 ? (
                        <div className="mt-2 pt-2 border-t border-edge-subtle text-[10px] text-ink-faint">
                          <span className="font-medium text-accent">Sources:</span>{' '}
                          {m.citations.map((c) => c.excerpt.slice(0, 50) + '...').join(' | ')}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* AI RAG Retrieval Draft Metadata Notice */}
            {aiMetadata ? (
              <div className="mx-3 my-2 p-2.5 rounded bg-accent-wash border border-accent/30 text-xs text-ink space-y-1">
                <div className="flex items-center justify-between font-bold text-[11px] text-accent">
                  <span>AI Approved RAG Retrieval Draft</span>
                  <span>Confidence: {aiMetadata.confidence}%</span>
                </div>
                {aiMetadata.citations && aiMetadata.citations.length > 0 ? (
                  <div className="text-[10.5px] text-ink-muted">
                    <span className="font-semibold">Sources ({aiMetadata.citations.length}):</span>{' '}
                    {aiMetadata.citations.map((c) => `${c.title} (${c.accessLevel})`).join(' · ')}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Status Message Notice */}
            {statusMessage ? (
              <div
                className={`mx-3 my-1 p-2 rounded text-xs font-mono ${
                  statusMessage.type === 'success'
                    ? 'bg-status-good/10 text-status-good border border-status-good/30'
                    : 'bg-status-bad/10 text-status-bad border border-status-bad/30'
                }`}
              >
                {statusMessage.text}
              </div>
            ) : null}

            {/* Composer */}
            <div className="p-3 border-t border-edge bg-canvas">
              <div className="flex items-center justify-between mb-2">
                <div className="flex gap-1 border border-edge rounded p-0.5 text-xs">
                  <button
                    onClick={() => setComposerMode('reply')}
                    className={`px-2.5 py-0.5 rounded font-medium ${composerMode === 'reply' ? 'bg-accent text-white' : 'text-ink-muted'}`}
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => setComposerMode('note')}
                    className={`px-2.5 py-0.5 rounded font-medium ${composerMode === 'note' ? 'bg-status-warning text-white' : 'text-ink-muted'}`}
                  >
                    Internal Note
                  </button>
                </div>

                <div className="flex gap-1.5 text-[10px]">
                  <button
                    disabled={isAiLoading}
                    onClick={() => handleAiAction('find')}
                    className="px-2 py-1 rounded border border-edge hover:bg-canvas-overlay text-ink-muted disabled:opacity-50"
                  >
                    {isAiLoading ? 'Retrieving…' : 'Find Approved Answer'}
                  </button>
                  <button
                    disabled={isAiLoading}
                    onClick={() => handleAiAction('clarify')}
                    className="px-2 py-1 rounded border border-edge hover:bg-canvas-overlay text-ink-muted disabled:opacity-50"
                  >
                    {isAiLoading ? 'Synthesizing…' : 'Clarify'}
                  </button>
                </div>
              </div>

              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={
                  composerMode === 'reply'
                    ? 'Type official outbound response...'
                    : 'Type internal note for teammate...'
                }
                className="w-full h-20 p-2 text-xs rounded border border-edge bg-canvas text-ink focus:outline-none focus:border-accent resize-none"
              />

              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-ink-faint">
                  {composerMode === 'reply'
                    ? 'Outbound delivery logged in audit trail'
                    : 'Internal notes visible only to workspace members'}
                </span>
                <button
                  disabled={isSending || !replyText.trim()}
                  onClick={handleSendReply}
                  className="px-4 py-1.5 text-xs font-semibold rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {isSending ? 'Sending…' : composerMode === 'reply' ? 'Send Reply' : 'Post Note'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-ink-faint">No conversation selected</div>
        )}
      </Panel>

      {/* RIGHT COLUMN: Customer 360 Intelligence Panel (4 Cols) */}
      <Panel className="lg:col-span-4 flex flex-col h-full overflow-y-auto p-4 border border-edge space-y-4">
        {contact ? (
          <>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-2">
                Customer 360
              </h3>
              <div className="p-3 rounded border border-edge bg-canvas-overlay">
                <div className="text-sm font-semibold text-ink">{contact.displayName}</div>
                <div className="text-xs text-ink-muted">
                  {contact.primaryEmail || 'Email not provided'}
                </div>
                {contact.company ? (
                  <div className="mt-1 text-xs text-accent font-medium">{contact.company.name}</div>
                ) : null}
              </div>
            </div>

            {/* Explainable Lead Score */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-2">
                Explainable Lead Score
              </h3>
              <div className="p-3 rounded border border-edge bg-canvas-overlay">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-bold text-ink">{contact.leadScore} / 100</span>
                  <Badge tone={contact.leadScore >= 70 ? 'good' : 'neutral'}>
                    {contact.leadTier}
                  </Badge>
                </div>
                {contact.scoreFactors && Array.isArray(contact.scoreFactors) ? (
                  <div className="space-y-1 mt-2 text-[11px] divide-y divide-edge-subtle">
                    {contact.scoreFactors.map(
                      (sf: { factor: string; points: number }, idx: number) => (
                        <div
                          key={idx}
                          className="pt-1 flex items-center justify-between text-ink-muted"
                        >
                          <span>{sf.factor}</span>
                          <span className="font-semibold text-status-good">+{sf.points}</span>
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {/* AI Customer Intelligence */}
            {intel ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-2">
                  AI Customer Intelligence
                </h3>
                <div className="p-3 rounded border border-edge bg-canvas-overlay space-y-2 text-xs">
                  <div>
                    <span className="font-semibold text-ink">Summary:</span>
                    <p className="mt-0.5 text-ink-muted text-[11px] leading-relaxed">
                      {intel.summary}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-edge-subtle text-[11px]">
                    <div>
                      <span className="text-ink-faint block">Primary Intent</span>
                      <span className="font-medium text-ink">{intel.primaryIntent}</span>
                    </div>
                    <div>
                      <span className="text-ink-faint block">Product Interest</span>
                      <span className="font-medium text-ink">
                        {intel.productInterest || 'Not specified'}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-faint block">Seat Count</span>
                      <span className="font-medium text-ink">
                        {intel.seatRequirement ? `~${intel.seatRequirement} users` : 'Not stated'}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-faint block">Timeline</span>
                      <span className="font-medium text-ink">{intel.timeline || 'Not stated'}</span>
                    </div>
                  </div>

                  {intel.explicitRequirements && intel.explicitRequirements.length > 0 ? (
                    <div className="pt-2 border-t border-edge-subtle text-[11px]">
                      <span className="text-ink-faint block mb-1">Explicit Requirements</span>
                      <div className="flex flex-wrap gap-1">
                        {intel.explicitRequirements.map((req, idx) => (
                          <Badge key={idx} tone="iris">
                            {req}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Actions & Related Records */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-2">
                Workflows
              </h3>
              <div className="space-y-1.5 text-xs">
                {selected.deals && selected.deals.length > 0 ? (
                  selected.deals.map((d) => (
                    <div
                      key={d.id}
                      className="p-2 rounded border border-edge bg-canvas flex items-center justify-between"
                    >
                      <span>{d.name}</span>
                      <span className="font-medium text-accent">
                        ${(d.amount || 0).toLocaleString()}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-2 rounded border border-edge bg-canvas flex items-center justify-between">
                    <span>Active Workspace Conversation</span>
                    <span className="font-medium text-status-good">Connected</span>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-ink-faint">
            Select a conversation to view Customer 360
          </div>
        )}
      </Panel>
    </div>
  );
}
