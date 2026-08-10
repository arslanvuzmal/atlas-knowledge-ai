'use client';

import { useState } from 'react';
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
  const [selectedId, setSelectedId] = useState<string>(conversations[0]?.id ?? '');
  const [composerMode, setComposerMode] = useState<'reply' | 'note'>('reply');
  const [replyText, setReplyText] = useState('');
  const [notes, setNotes] = useState<{ id: string; content: string; createdAt: string }[]>([]);

  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0];
  const contact = selected?.contact;
  const intel = contact?.intelligence;

  const handleSendReply = () => {
    if (!replyText.trim()) return;
    if (composerMode === 'note') {
      setNotes((prev) => [
        ...prev,
        {
          id: `note_${Date.now()}`,
          content: replyText,
          createdAt: new Date().toLocaleTimeString(),
        },
      ]);
    } else {
      if (selected) {
        selected.messages.push({
          id: `msg_${Date.now()}`,
          role: 'ASSISTANT',
          content: replyText,
          createdAt: new Date().toLocaleTimeString(),
        });
      }
    }
    setReplyText('');
  };

  const handleAiDraft = (type: 'shorten' | 'clarify' | 'find') => {
    if (type === 'shorten') {
      setReplyText((prev) => (prev ? prev.slice(0, Math.floor(prev.length * 0.6)) + '…' : ''));
    } else if (type === 'clarify') {
      setReplyText(
        'Thank you for reaching out! To help us tailor the Team plan for your 80 users, could you confirm if you require SAML SSO integration?',
      );
    } else if (type === 'find') {
      setReplyText(
        'Based on approved Northstar Cloud documentation: Annual subscriptions include a 30-day money-back guarantee, while monthly subscriptions allow 14-day refund windows.',
      );
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* LEFT COLUMN: Conversation List & Filters (3 Cols) */}
      <Panel className="lg:col-span-3 flex flex-col h-full overflow-hidden p-0 border border-edge">
        <div className="p-3 border-b border-edge bg-canvas-sunken">
          <input
            type="text"
            placeholder="Search conversations..."
            className="w-full px-3 py-1.5 text-xs rounded border border-edge bg-canvas text-ink focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2 mt-2">
            <span className="text-[11px] font-medium text-accent cursor-pointer">
              All ({conversations.length})
            </span>
            <span className="text-[11px] text-ink-faint cursor-pointer hover:text-ink">
              Needs Human
            </span>
            <span className="text-[11px] text-ink-faint cursor-pointer hover:text-ink">
              High Intent
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-edge-subtle">
          {conversations.map((c) => {
            const isSelected = c.id === selectedId;
            const lastMsg = c.messages[c.messages.length - 1];
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
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
          })}
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
              {selected.messages.map((m) => (
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
                      {m.role === 'USER' ? contact?.displayName || 'Customer' : 'Atlas Assistant'}
                    </div>
                    {m.content}

                    {m.citations && m.citations.length > 0 ? (
                      <div className="mt-2 pt-2 border-t border-edge-subtle text-[10px] text-ink-faint">
                        <span className="font-medium">Sources:</span>{' '}
                        {m.citations.map((c) => c.excerpt.slice(0, 50) + '...').join(' | ')}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {notes.map((n) => (
                <div
                  key={n.id}
                  className="p-2.5 rounded bg-status-warning/10 border border-status-warning/30 text-xs text-ink"
                >
                  <span className="font-semibold text-status-warning text-[10px]">
                    Internal Note:
                  </span>{' '}
                  {n.content}
                </div>
              ))}
            </div>

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
                    onClick={() => handleAiDraft('find')}
                    className="px-2 py-1 rounded border border-edge hover:bg-canvas-overlay text-ink-muted"
                  >
                    Find Approved Answer
                  </button>
                  <button
                    onClick={() => handleAiDraft('clarify')}
                    className="px-2 py-1 rounded border border-edge hover:bg-canvas-overlay text-ink-muted"
                  >
                    Clarify
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
                  Human controls final outbound reply
                </span>
                <button
                  onClick={handleSendReply}
                  className="px-4 py-1.5 text-xs font-semibold rounded bg-accent text-white hover:bg-accent/90"
                >
                  {composerMode === 'reply' ? 'Send Reply' : 'Post Note'}
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
                <div className="p-2 rounded border border-edge bg-canvas flex items-center justify-between">
                  <span>Open Deal</span>
                  <span className="font-medium text-accent">$24,000 ARR</span>
                </div>
                <div className="p-2 rounded border border-edge bg-canvas flex items-center justify-between">
                  <span>Pending Task</span>
                  <span className="font-medium text-status-warning">Follow up demo call</span>
                </div>
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
