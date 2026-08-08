'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  EscalationStatus,
  EscalationResolutionCategory,
  Role,
  UserStatus,
} from '@prisma/client';
import { apiFetch, cn } from '@/lib/ui';
import { ROLE_LABELS } from '@/lib/auth/rbac';

const smallButton =
  'rounded-md border border-edge px-2.5 py-1 text-xs font-medium text-ink-muted transition hover:border-edge-strong hover:text-ink disabled:opacity-60';

// ---------------------------------------------------------------------------
// Escalation queue
// ---------------------------------------------------------------------------

export function EscalationControls({
  escalationId,
  status,
  assignees,
  assignedTo,
  resolutionCategory,
}: {
  escalationId: string;
  status: EscalationStatus;
  assignees: { id: string; name: string }[];
  assignedTo: string | null;
  resolutionCategory: EscalationResolutionCategory | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/escalations/${escalationId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const nextStatus: Partial<Record<EscalationStatus, { label: string; value: EscalationStatus }>> =
    {
      OPEN: { label: 'Start work', value: 'IN_PROGRESS' },
      ASSIGNED: { label: 'Start work', value: 'IN_PROGRESS' },
      IN_PROGRESS: { label: 'Mark resolved', value: 'RESOLVED' },
      RESOLVED: { label: 'Close', value: 'CLOSED' },
    };
  const advance = nextStatus[status];

  const showResolutionCategory = status === 'RESOLVED' || status === 'CLOSED';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`assign-${escalationId}`} className="sr-only">
        Assign this escalation
      </label>
      <select
        id={`assign-${escalationId}`}
        value={assignedTo ?? ''}
        disabled={busy}
        onChange={(event) => patch({ assignedTo: event.target.value || null })}
        className="rounded-md border border-edge bg-canvas-sunken px-2 py-1 text-xs text-ink"
      >
        <option value="">Unassigned</option>
        {assignees.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>

      {advance ? (
        <button
          type="button"
          className={smallButton}
          disabled={busy}
          onClick={() => patch({ status: advance.value })}
        >
          {advance.label}
        </button>
      ) : null}

      {showResolutionCategory ? (
        <select
          value={resolutionCategory ?? ''}
          disabled={busy}
          onChange={(event) => patch({ resolutionCategory: event.target.value || null })}
          className="rounded-md border border-edge bg-canvas-sunken px-2 py-1 text-xs text-ink"
        >
          <option value="">Resolution category</option>
          <option value="MISSING_KNOWLEDGE">Missing knowledge</option>
          <option value="OUTDATED_SOURCE">Outdated source</option>
          <option value="CONFLICTING_SOURCE">Conflicting source</option>
          <option value="RETRIEVAL_FAILURE">Retrieval failure</option>
          <option value="ACCESS_PROBLEM">Access problem</option>
          <option value="INCORRECT_ANSWER">Incorrect answer</option>
          <option value="USER_MISUNDERSTANDING">User misunderstanding</option>
          <option value="OTHER">Other</option>
        </select>
      ) : null}

      {error ? (
        <span role="alert" className="text-xs text-status-critical">
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback review
// ---------------------------------------------------------------------------

export function FeedbackReviewToggle({
  feedbackId,
  reviewed,
}: {
  feedbackId: string;
  reviewed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(reviewed);

  async function toggle() {
    setBusy(true);
    const result = await apiFetch<{ reviewed: boolean }>(`/api/feedback/${feedbackId}`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewed: !state }),
    });
    setBusy(false);
    if (result.ok) {
      setState(result.data.reviewed);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={cn(smallButton, state && 'border-status-good/40 text-status-good')}
    >
      {state ? 'Reviewed' : 'Mark reviewed'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// User administration
// ---------------------------------------------------------------------------

export function UserControls({
  userId,
  role,
  status,
  assignableRoles,
  isSelf,
}: {
  userId: string;
  role: Role;
  status: UserStatus;
  assignableRoles: Role[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (isSelf) {
    return <span className="text-xs text-ink-faint">This is you</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label htmlFor={`role-${userId}`} className="sr-only">
        Role
      </label>
      <select
        id={`role-${userId}`}
        value={role}
        disabled={busy}
        onChange={(event) => patch({ role: event.target.value })}
        className="rounded-md border border-edge bg-canvas-sunken px-2 py-1 text-xs text-ink"
      >
        {assignableRoles.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABELS[option]}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={smallButton}
        disabled={busy}
        onClick={() => patch({ status: status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}
      >
        {status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
      </button>

      {error ? (
        <span role="alert" className="w-full text-right text-xs text-status-critical">
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retrieval settings
// ---------------------------------------------------------------------------

export interface RetrievalSettingsValues {
  chunkSize: number;
  chunkOverlap: number;
  retrievalCount: number;
  rerankCount: number;
  confidenceThreshold: number;
  citationCount: number;
  hybridSearch: boolean;
  queryRewriting: boolean;
  conversationHistoryLength: number;
}

const NUMERIC_FIELDS: {
  key: keyof RetrievalSettingsValues;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}[] = [
  {
    key: 'chunkSize',
    label: 'Chunk size (characters)',
    min: 200,
    max: 4000,
    step: 50,
    hint: 'Applies to newly processed documents. Reprocess existing ones to rebuild them.',
  },
  {
    key: 'chunkOverlap',
    label: 'Chunk overlap (characters)',
    min: 0,
    max: 1000,
    step: 10,
    hint: 'Carried from the end of the previous passage, snapped to a sentence boundary.',
  },
  {
    key: 'retrievalCount',
    label: 'Passages retrieved',
    min: 1,
    max: 50,
    step: 1,
    hint: 'First-stage candidates from each of vector and keyword search.',
  },
  {
    key: 'rerankCount',
    label: 'Passages kept after reranking',
    min: 1,
    max: 25,
    step: 1,
    hint: 'Cannot exceed the retrieved count.',
  },
  {
    key: 'citationCount',
    label: 'Maximum citations shown',
    min: 1,
    max: 10,
    step: 1,
    hint: 'Cannot exceed the reranked count.',
  },
  {
    key: 'conversationHistoryLength',
    label: 'Conversation history turns',
    min: 0,
    max: 20,
    step: 1,
    hint: 'How many previous turns inform follow-up questions.',
  },
];

export function RetrievalSettingsForm({
  initial,
  readOnly,
}: {
  initial: RetrievalSettingsValues;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  function update<K extends keyof RetrievalSettingsValues>(
    key: K,
    value: RetrievalSettingsValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const result = await apiFetch<{ note: string | null }>('/api/settings/retrieval', {
      method: 'PUT',
      body: JSON.stringify(values),
    });
    setBusy(false);

    if (!result.ok) {
      setMessage({ tone: 'bad', text: result.error });
      return;
    }
    setMessage({
      tone: 'good',
      text: result.data.note ?? 'Retrieval settings saved. They apply to the next question asked.',
    });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5 px-5 py-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {NUMERIC_FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={field.key} className="mb-1.5 block text-sm font-medium text-ink">
              {field.label}
            </label>
            <input
              id={field.key}
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={readOnly || busy}
              value={values[field.key] as number}
              onChange={(event) => update(field.key, Number(event.target.value) as never)}
              className="field"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{field.hint}</p>
          </div>
        ))}

        <div>
          <label
            htmlFor="confidenceThreshold"
            className="mb-1.5 block text-sm font-medium text-ink"
          >
            Confidence threshold
          </label>
          <div className="flex items-center gap-3">
            <input
              id="confidenceThreshold"
              type="range"
              min={0}
              max={1}
              step={0.01}
              disabled={readOnly || busy}
              value={values.confidenceThreshold}
              onChange={(event) => update('confidenceThreshold', Number(event.target.value))}
              className="flex-1 accent-[#00a3c3]"
            />
            <span className="w-12 shrink-0 text-right font-mono text-sm tabular-nums text-ink">
              {values.confidenceThreshold.toFixed(2)}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
            Below this, answers are marked partially supported or unsupported and an escalation is
            raised.
          </p>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="sr-only">Retrieval features</legend>
        {[
          {
            key: 'hybridSearch' as const,
            label: 'Hybrid search',
            hint: 'Combine vector similarity with PostgreSQL full-text search by reciprocal rank fusion.',
          },
          {
            key: 'queryRewriting' as const,
            label: 'Query rewriting',
            hint: 'Expand follow-up questions with topical terms from recent turns before retrieving.',
          },
        ].map((toggle) => (
          <label key={toggle.key} className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              disabled={readOnly || busy}
              checked={values[toggle.key]}
              onChange={(event) => update(toggle.key, event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#00a3c3]"
            />
            <span>
              <span className="block text-sm font-medium text-ink">{toggle.label}</span>
              <span className="block text-[11px] text-ink-faint">{toggle.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {!readOnly ? (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          <button
            type="button"
            className={smallButton}
            disabled={busy}
            onClick={() => setValues(initial)}
          >
            Reset
          </button>
        </div>
      ) : (
        <p className="text-xs text-ink-faint">You can view these settings but not change them.</p>
      )}

      {message ? (
        <p
          role="status"
          className={
            message.tone === 'good' ? 'text-sm text-status-good' : 'text-sm text-status-critical'
          }
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Model settings
// ---------------------------------------------------------------------------

export function ModelSettingsForm({
  initial,
  availableProviders,
  readOnly,
}: {
  initial: { llmProviderOverride: string; maxAnswerTokens: number; temperature: number };
  availableProviders: { value: string; label: string; configured: boolean }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const result = await apiFetch('/api/settings/models', {
      method: 'PUT',
      body: JSON.stringify({ ...values, embeddingProviderOverride: '' }),
    });
    setBusy(false);

    if (!result.ok) {
      setMessage({ tone: 'bad', text: result.error });
      return;
    }
    setMessage({ tone: 'good', text: 'Provider settings saved.' });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5 px-5 py-5">
      <div>
        <label htmlFor="llm-provider" className="mb-1.5 block text-sm font-medium text-ink">
          Language model provider
        </label>
        <select
          id="llm-provider"
          value={values.llmProviderOverride}
          disabled={readOnly || busy}
          onChange={(event) =>
            setValues((current) => ({ ...current, llmProviderOverride: event.target.value }))
          }
          className="field max-w-sm"
        >
          <option value="">Follow environment configuration</option>
          {availableProviders.map((provider) => (
            <option key={provider.value} value={provider.value} disabled={!provider.configured}>
              {provider.label}
              {provider.configured ? '' : ' — no credential configured'}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          A provider without its credential cannot be selected. Choosing one that later loses its
          credential falls back to the environment setting rather than failing every request.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="max-tokens" className="mb-1.5 block text-sm font-medium text-ink">
            Maximum answer length (tokens)
          </label>
          <input
            id="max-tokens"
            type="number"
            min={128}
            max={4096}
            step={32}
            disabled={readOnly || busy}
            value={values.maxAnswerTokens}
            onChange={(event) =>
              setValues((current) => ({ ...current, maxAnswerTokens: Number(event.target.value) }))
            }
            className="field"
          />
        </div>
        <div>
          <label htmlFor="temperature" className="mb-1.5 block text-sm font-medium text-ink">
            Temperature
          </label>
          <div className="flex items-center gap-3">
            <input
              id="temperature"
              type="range"
              min={0}
              max={1}
              step={0.05}
              disabled={readOnly || busy}
              value={values.temperature}
              onChange={(event) =>
                setValues((current) => ({ ...current, temperature: Number(event.target.value) }))
              }
              className="flex-1 accent-[#00a3c3]"
            />
            <span className="w-12 shrink-0 text-right font-mono text-sm tabular-nums text-ink">
              {values.temperature.toFixed(2)}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Low values keep answers close to the source wording, which is what grounding wants.
          </p>
        </div>
      </div>

      {!readOnly ? (
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save providers'}
        </button>
      ) : (
        <p className="text-xs text-ink-faint">You can view these settings but not change them.</p>
      )}

      {message ? (
        <p
          role="status"
          className={
            message.tone === 'good' ? 'text-sm text-status-good' : 'text-sm text-status-critical'
          }
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Demo reset
// ---------------------------------------------------------------------------

export function DemoResetButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setMessage(null);
    const result = await apiFetch<{ cleared: Record<string, number>; note: string }>(
      '/api/demo/reset',
      { method: 'POST' },
    );
    setBusy(false);
    setConfirming(false);

    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage(
      `Cleared ${result.data.cleared.conversations} conversations, ${result.data.cleared.escalations} escalations and ${result.data.cleared.retrievalLogs} retrieval logs. ${result.data.note}`,
    );
    router.refresh();
  }

  return (
    <div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-status-warning">
            Clear all demo conversations, feedback and escalations?
          </span>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded-md border border-status-warning/50 px-3 py-1.5 text-xs font-medium text-status-warning transition hover:bg-status-warning/10 disabled:opacity-60"
          >
            {busy ? 'Clearing…' : 'Yes, clear'}
          </button>
          <button type="button" className={smallButton} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-edge-strong px-4 py-2 text-sm font-medium text-ink transition hover:border-status-warning hover:text-status-warning"
        >
          Reset demo activity
        </button>
      )}

      {message ? (
        <p role="status" className="mt-3 text-sm text-ink-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}
