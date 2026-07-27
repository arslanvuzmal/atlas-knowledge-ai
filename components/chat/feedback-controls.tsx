'use client';

import { useState } from 'react';
import { apiFetch, cn } from '@/lib/ui';

type Rating = 'HELPFUL' | 'PARTIALLY_HELPFUL' | 'NOT_HELPFUL';

const REASONS: { value: string; label: string }[] = [
  { value: 'INCORRECT_ANSWER', label: 'Incorrect answer' },
  { value: 'MISSING_INFORMATION', label: 'Missing information' },
  { value: 'WRONG_SOURCE', label: 'Wrong source' },
  { value: 'OUTDATED_INFORMATION', label: 'Outdated information' },
  { value: 'TOO_VAGUE', label: 'Too vague' },
  { value: 'ACCESS_ISSUE', label: 'Access issue' },
  { value: 'OTHER', label: 'Other' },
];

export function FeedbackControls({
  messageId,
  answerText,
  onEscalated,
}: {
  messageId: string;
  answerText: string;
  onEscalated?: (escalationId: string) => void;
}) {
  const [submitted, setSubmitted] = useState<Rating | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalation, setEscalation] = useState<string | null>(null);

  async function send(rating: Rating, reason?: string) {
    setError(null);
    const result = await apiFetch<{ escalationId: string | null }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ messageId, rating, reason: reason ?? null }),
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSubmitted(rating);
    setShowReasons(false);
    if (result.data.escalationId) {
      setEscalation(result.data.escalationId);
      onEscalated?.(result.data.escalationId);
    }
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(answerText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  }

  const buttonClass =
    'inline-flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:border-edge-strong hover:text-ink disabled:opacity-60';

  return (
    <div className="mt-4 border-t border-edge-subtle pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {submitted ? (
          <p className="text-xs text-ink-muted" role="status">
            Thank you — your feedback was recorded.
          </p>
        ) : (
          <>
            <span className="text-xs text-ink-faint">Was this helpful?</span>
            <button type="button" className={buttonClass} onClick={() => send('HELPFUL')}>
              Yes
            </button>
            <button type="button" className={buttonClass} onClick={() => send('PARTIALLY_HELPFUL')}>
              Partly
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setShowReasons((open) => !open)}
              aria-expanded={showReasons}
            >
              No
            </button>
          </>
        )}

        <span className="ml-auto flex items-center gap-2">
          <button type="button" className={buttonClass} onClick={copyAnswer}>
            {copied ? 'Copied' : 'Copy answer'}
          </button>
        </span>
      </div>

      {showReasons ? (
        <div className="mt-3 rounded-md border border-edge bg-canvas-sunken p-3">
          <p className="text-xs font-medium text-ink">What was wrong with it?</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REASONS.map((reason) => (
              <button
                key={reason.value}
                type="button"
                className="rounded-md border border-edge px-2.5 py-1 text-xs text-ink-muted transition hover:border-status-critical/50 hover:text-ink"
                onClick={() => send('NOT_HELPFUL', reason.value)}
              >
                {reason.label}
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-ink-faint">
            Negative feedback creates a human escalation with the full conversation attached.
          </p>
        </div>
      ) : null}

      {escalation ? (
        <p className="mt-2 text-xs text-status-warning" role="status">
          A human review has been raised for this answer.
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-status-critical" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function EscalationButton({
  conversationId,
  disabled,
}: {
  conversationId: string | null;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function request() {
    if (!conversationId || state === 'sending' || state === 'sent') return;
    setState('sending');

    const result = await apiFetch<{ escalationId: string; alreadyOpen: boolean }>(
      '/api/escalations',
      {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
      },
    );

    if (!result.ok) {
      setState('error');
      setMessage(result.error);
      return;
    }

    setState('sent');
    setMessage(
      result.data.alreadyOpen
        ? 'A human review was already open for this conversation.'
        : 'A human review has been raised with the full conversation attached.',
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={disabled || !conversationId || state === 'sending' || state === 'sent'}
        onClick={request}
        className={cn(
          'rounded-md border border-edge px-3 py-1.5 text-xs font-medium transition',
          state === 'sent'
            ? 'border-status-warning/40 text-status-warning'
            : 'text-ink-muted hover:border-edge-strong hover:text-ink',
          'disabled:opacity-60',
        )}
      >
        {state === 'sending'
          ? 'Requesting…'
          : state === 'sent'
            ? 'Human review requested'
            : 'Ask for a human'}
      </button>
      {message ? (
        <p
          role="status"
          className={cn(
            'text-[11px]',
            state === 'error' ? 'text-status-critical' : 'text-ink-faint',
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
